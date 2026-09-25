"use server"

import { auth } from "@/auth"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { isValidPgId, isP2002 } from "@/lib/validation"
import type { ActionResult } from "./types"

// --- Service types ---

const ServiceTypeSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
})

export async function createServiceType(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const parsed = ServiceTypeSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const existing = await prisma.serviceType.findFirst({ where: { name: parsed.data.name } })
  if (existing) return { error: "Service type already exists" }
  // name is @unique — a concurrent duplicate slips past the findFirst check and
  // throws a raw P2002. Map it to the same friendly error.
  try {
    await prisma.serviceType.create({ data: { name: parsed.data.name } })
  } catch (e) {
    if (isP2002(e)) return { error: "Service type already exists" }
    throw e
  }
  revalidatePath("/accounting/petty-cash/service-types")
  redirect("/accounting/petty-cash/service-types")
}

export async function toggleServiceTypeActive(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const existing = await prisma.serviceType.findUnique({ where: { id } })
  if (!existing) return { error: "Service type not found" }
  await prisma.serviceType.update({ where: { id }, data: { isActive: !existing.isActive } })
  revalidatePath("/accounting/petty-cash/service-types")
}

export async function deleteServiceType(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const count = await prisma.pettyCashReceipt.count({ where: { serviceTypeId: id } })
  if (count > 0) return { error: `Cannot delete — ${count} receipt(s) use this service type` }
  // A receipt referencing this type can be created between the count and the
  // delete — the FK then throws a raw P2003. Map it to the same message.
  try {
    await prisma.serviceType.delete({ where: { id } })
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2003")
      return { error: "Cannot delete — receipt(s) use this service type" }
    throw e
  }
  revalidatePath("/accounting/petty-cash/service-types")
}
