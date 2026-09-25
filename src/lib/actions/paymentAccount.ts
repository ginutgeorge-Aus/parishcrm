"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import type { ActionResultWithSuccess } from "./types"

const NameKindSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  kind: z.enum(["BANK", "CASH"]),
})
const NameSchema = z.object({ name: z.string().trim().min(1, "Name is required").max(60) })

function revalidate() {
  revalidatePath("/accounting/settings")
  revalidatePath("/accounting/transactions")
  revalidatePath("/accounting/reconciliation")
  revalidatePath("/accounting/reports/balance-sheet")
  revalidatePath("/accounting/reports/cash-flow")
  revalidatePath("/")
}

export async function createPaymentAccount(
  _prev: ActionResultWithSuccess,
  formData: FormData
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const parsed = NameKindSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { name, kind } = parsed.data

  if (kind === "CASH") {
    const existingCash = await prisma.paymentAccount.findFirst({ where: { kind: "CASH", isActive: true } })
    if (existingCash) return { error: "Only one active cash account is allowed" }
  }
  try {
    const created = await prisma.paymentAccount.create({ data: { name, kind } })
    void logAudit(actorId(session), "SETTING_UPDATED", "PaymentAccount", created.id, { name, kind })
  } catch {
    return { error: "Failed to save (name may already exist)" }
  }
  revalidate()
  return { success: "Account added" }
}

export async function renamePaymentAccount(
  id: number,
  _prev: ActionResultWithSuccess,
  formData: FormData
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!Number.isInteger(id) || id <= 0) return { error: "Invalid account" }
  const parsed = NameSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  try {
    await prisma.paymentAccount.update({ where: { id }, data: { name: parsed.data.name } })
    void logAudit(actorId(session), "SETTING_UPDATED", "PaymentAccount", id, { name: parsed.data.name })
  } catch {
    return { error: "Failed to save (name may already exist)" }
  }
  revalidate()
  return { success: "Renamed" }
}

export async function setDefaultAccount(id: number): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!Number.isInteger(id) || id <= 0) return { error: "Invalid account" }
  const acct = await prisma.paymentAccount.findUnique({ where: { id } })
  if (!acct) return { error: "Account not found" }
  if (acct.kind !== "BANK") return { error: "The default account must be a bank account" }
  if (!acct.isActive) return { error: "Activate the account before making it the default" }
  // Unset the prior default and set the new one atomically (partial-unique index forbids two).
  try {
    await prisma.$transaction([
      prisma.paymentAccount.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
      prisma.paymentAccount.update({ where: { id }, data: { isDefault: true } }),
    ])
  } catch {
    return { error: "Failed to save" }
  }
  void logAudit(actorId(session), "SETTING_UPDATED", "PaymentAccount", id, { isDefault: true })
  revalidate()
  return { success: "Default set" }
}

export async function setAccountActive(id: number, active: boolean): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!Number.isInteger(id) || id <= 0) return { error: "Invalid account" }
  const acct = await prisma.paymentAccount.findUnique({ where: { id } })
  if (!acct) return { error: "Account not found" }
  if (!active) {
    if (acct.isDefault) return { error: "Reassign the default account before deactivating this one" }
    if (acct.kind === "CASH") {
      const activeCash = await prisma.paymentAccount.count({ where: { kind: "CASH", isActive: true } })
      if (activeCash <= 1) return { error: "Cannot deactivate the only active cash account" }
    }
  } else if (acct.kind === "CASH") {
    const activeCash = await prisma.paymentAccount.count({ where: { kind: "CASH", isActive: true } })
    if (activeCash >= 1) return { error: "Only one active cash account is allowed" }
  }
  try {
    await prisma.paymentAccount.update({ where: { id }, data: { isActive: active } })
  } catch {
    return { error: "Failed to save" }
  }
  void logAudit(actorId(session), "SETTING_UPDATED", "PaymentAccount", id, { isActive: active })
  revalidate()
  return { success: active ? "Activated" : "Deactivated" }
}
