"use server"

import { auth } from "@/auth"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { isValidPgId, isP2002 } from "@/lib/validation"
import type { ActionResult } from "./types"
import { assertNotDemo } from "@/lib/demoMode"
import { featureGuard } from "@/lib/featureFlags"
import { logAudit, logAuditTx } from "@/lib/audit"
import { actorId } from "@/lib/actor"

// --- Service types ---

const ServiceTypeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
})

/** Add a petty cash service type. ADMIN; blocked in demo mode and while Petty cash is off. */
export async function createServiceType(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("pettyCash")
  if (off) return off
  const parsed = ServiceTypeSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  // Compare trimmed + case-folded on both sides in JS (Prisma `equals` cannot trim the stored value),
  // so a legacy " Sunday" row still collides with "sunday". The table is tiny.
  const wanted = parsed.data.name.toLowerCase()
  const all = await prisma.serviceType.findMany({ select: { id: true, name: true } })
  const existing = all.find((t) => t.name.trim().toLowerCase() === wanted)
  if (existing) return { error: "Service type already exists" }
  // name is @unique — a concurrent duplicate slips past the findFirst check and
  // throws a raw P2002. Map it to the same friendly error.
  let created: { id: number }
  try {
    created = await prisma.serviceType.create({ data: { name: parsed.data.name } })
  } catch (e) {
    if (isP2002(e)) return { error: "Service type already exists" }
    throw e
  }
  await logAudit(actorId(session), "SERVICE_TYPE_CREATED", "ServiceType", created.id, {})
  revalidatePath("/accounting/petty-cash/service-types")
  redirect("/accounting/petty-cash/service-types")
}

/** Flip a service type's active flag. ADMIN; blocked in demo mode and while Petty cash is off. */
export async function toggleServiceTypeActive(id: number): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("pettyCash")
  if (off) return off
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const existing = await prisma.serviceType.findUnique({ where: { id } })
  if (!existing) return { error: "Service type not found" }
  await prisma.serviceType.update({ where: { id }, data: { isActive: !existing.isActive } })
  await logAudit(actorId(session), "SERVICE_TYPE_TOGGLED", "ServiceType", id, { isActive: !existing.isActive })
  revalidatePath("/accounting/petty-cash/service-types")
}

/** Delete an unused service type. ADMIN; blocked in demo mode and while Petty cash is off. */
export async function deleteServiceType(id: number): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("pettyCash")
  if (off) return off
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const count = await prisma.pettyCashReceipt.count({ where: { serviceTypeId: id } })
  if (count > 0) return { error: `Cannot delete — ${count} receipt(s) use this service type` }
  // Headcounts reference the type with onDelete: Restrict, so they block the delete too.
  const headcounts = await prisma.serviceHeadcount.count({ where: { serviceTypeId: id } })
  if (headcounts > 0) return { error: `Cannot delete — ${headcounts} headcount record(s) use this service type` }
  // A receipt referencing this type can be created between the count and the
  // delete — the FK then throws a raw P2003. Map it to the same message.
  // The audit row commits with the delete (logAudit swallows errors, so a separate write could leave no trail).
  try {
    await prisma.$transaction(async (tx) => {
      await tx.serviceType.delete({ where: { id } })
      await logAuditTx(tx, actorId(session), "SERVICE_TYPE_DELETED", "ServiceType", id, {})
    })
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2003")
      return { error: "Cannot delete — records use this service type" }
    throw e
  }
  revalidatePath("/accounting/petty-cash/service-types")
}
