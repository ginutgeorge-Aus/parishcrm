"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { encryptOrNull, decryptOrNull } from "@/lib/nullableCrypto"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { UserRole } from "@/lib/generated/prisma/enums"
import { isValidEmail, isValidPgId } from "@/lib/validation"
import type { ActionResult } from "./types"

const LIST_PATH = "/accounting/customers"

export type CustomerView = {
  id: number; name: string; abn: string | null; email: string | null; phone: string | null
  address: string | null; notes: string | null; isActive: boolean
}

const CustomerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  abn: z.string().trim().transform((v) => v.replace(/\s/g, "")).refine((v) => v === "" || /^\d{11}$/.test(v), "ABN must be 11 digits"),
  email: z.string().trim().max(254).refine((v) => v === "" || isValidEmail(v), "Enter a valid email"),
  phone: z.string().trim().max(40),
  address: z.string().trim().max(500),
  notes: z.string().trim().max(2000),
})


/** Validate customer form fields and return the encrypted Prisma payload. */
function parseCustomer(formData: FormData): { data: { name: string; abn: string | null; email: string | null; phone: string | null; address: string | null; notes: string | null } } | { error: string } {
  const get = (k: string) => String(formData.get(k) ?? "")
  const p = CustomerSchema.safeParse({ name: get("name"), abn: get("abn"), email: get("email"), phone: get("phone"), address: get("address"), notes: get("notes") })
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid customer" }
  const d = p.data
  return { data: { name: d.name, abn: d.abn || null, email: encryptOrNull(d.email), phone: encryptOrNull(d.phone), address: encryptOrNull(d.address), notes: encryptOrNull(d.notes) } }
}

/** Create a saved outside customer (ADMIN | PASTOR). */
export async function createCustomer(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const parsed = parseCustomer(formData)
  if ("error" in parsed) return parsed
  const row = await prisma.customer.create({ data: parsed.data })
  await logAudit(actorId(session), "CUSTOMER_CREATED", "Customer", row.id, {})
  revalidatePath(LIST_PATH)
  redirect(LIST_PATH)
}

/** Update a customer's details (ADMIN | PASTOR). Existing invoices keep their recipient snapshot. */
export async function updateCustomer(id: number, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Customer not found" }
  const parsed = parseCustomer(formData)
  if ("error" in parsed) return parsed
  try {
    await prisma.customer.update({ where: { id }, data: parsed.data })
  } catch {
    return { error: "Customer not found" }
  }
  await logAudit(actorId(session), "CUSTOMER_UPDATED", "Customer", id, {})
  revalidatePath(LIST_PATH)
  redirect(LIST_PATH)
}

/** Activate/deactivate a customer. Customers are never hard-deleted (invoices reference them). */
export async function setCustomerActive(id: number, isActive: boolean): Promise<{ error: string } | { success: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Customer not found" }
  if (typeof isActive !== "boolean") return { error: "Invalid request" }
  try {
    await prisma.customer.update({ where: { id }, data: { isActive } })
  } catch {
    return { error: "Customer not found" }
  }
  await logAudit(actorId(session), "CUSTOMER_ACTIVE_SET", "Customer", id, { isActive })
  revalidatePath(LIST_PATH)
  return { success: isActive ? "Customer reactivated" : "Customer deactivated" }
}

/** Quick-create from the invoice recipient picker; returns the new id + name. */
export async function createCustomerInline(input: { name: string; email: string; address: string }): Promise<{ id: number; name: string } | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const f = new FormData()
  f.set("name", input.name ?? ""); f.set("email", input.email ?? ""); f.set("address", input.address ?? "")
  const parsed = parseCustomer(f)
  if ("error" in parsed) return parsed
  const row = await prisma.customer.create({ data: parsed.data })
  await logAudit(actorId(session), "CUSTOMER_CREATED", "Customer", row.id, { inline: true })
  revalidatePath(LIST_PATH)
  return { id: row.id, name: row.name }
}

/** List customers for accounting viewers; AUDITOR gets names only (contact fields null, never decrypted). */
export async function listCustomers(opts: { includeInactive?: boolean } = {}): Promise<CustomerView[] | { error: string }> {
  const session = await auth()
  const role = session?.user?.role
  if (!canViewAccounting(role)) return { error: "Unauthorized" }
  const rows = await prisma.customer.findMany({
    where: opts.includeInactive ? {} : { isActive: true },
    orderBy: { name: "asc" },
  })
  const masked = role === UserRole.AUDITOR
  return rows.map((r) => ({
    id: r.id, name: r.name, abn: r.abn, isActive: r.isActive,
    email: masked ? null : decryptOrNull(r.email),
    phone: masked ? null : decryptOrNull(r.phone),
    address: masked ? null : decryptOrNull(r.address),
    notes: masked ? null : decryptOrNull(r.notes),
  }))
}

/** Load one customer decrypted for the edit form (ADMIN | PASTOR). */
export async function getCustomerForEdit(id: number): Promise<CustomerView | null> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role) || !isValidPgId(id)) return null
  const r = await prisma.customer.findUnique({ where: { id } })
  if (!r) return null
  return { id: r.id, name: r.name, abn: r.abn, isActive: r.isActive, email: decryptOrNull(r.email), phone: decryptOrNull(r.phone), address: decryptOrNull(r.address), notes: decryptOrNull(r.notes) }
}
