"use server"

import { z } from "zod"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/lib/generated/prisma/client"
import { isAdmin, canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { isValidPgId, isP2034 } from "@/lib/validation"
import type { ActionResult } from "./types"

const FundSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  isActive: z.string().optional().transform((v) => v === "on"),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
})

function revalidateFunds() {
  revalidatePath("/accounting/settings/funds")
  revalidatePath("/accounting/reports/funds")
}

export async function createFund(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const parsed = FundSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const existing = await prisma.fund.findUnique({ where: { name: parsed.data.name } })
  if (existing) return { error: "A fund with this name already exists" }
  await prisma.fund.create({ data: parsed.data })
  revalidateFunds()
  redirect("/accounting/settings/funds")
}

export async function updateFund(
  id: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const parsed = FundSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const existing = await prisma.fund.findUnique({ where: { id } })
  if (!existing) return { error: "Fund not found" }
  // "General" is the undeletable null-bucket fund (deleteFund guards it by name);
  // renaming it would silently strip that protection and free the name.
  if (existing.name === "General" && parsed.data.name !== "General")
    return { error: "The General fund cannot be renamed." }
  const dup = await prisma.fund.findUnique({ where: { name: parsed.data.name } })
  if (dup && dup.id !== id) return { error: "A fund with this name already exists" }
  await prisma.fund.update({ where: { id }, data: parsed.data })
  revalidateFunds()
  redirect("/accounting/settings/funds")
}

export async function deleteFund(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const fund = await prisma.fund.findUnique({ where: { id } })
  if (!fund) return { error: "Fund not found" }
  if (fund.name === "General") return { error: "The General fund cannot be deleted." }
  // Count + delete in one Serializable transaction: the FK is
  // ON DELETE SET NULL, so an entry inserted between a separate count and delete
  // would be silently un-tagged rather than blocking the delete. READ COMMITTED
  // (Postgres default) does NOT close that window — only Serializable does, by
  // aborting one side (P2034) when a concurrent insert conflicts with the read.
  let result: ActionResult | undefined
  try {
    result = await prisma.$transaction(
      async (txClient) => {
        const [tx, rc, ex] = await Promise.all([
          txClient.transaction.count({ where: { fundId: id } }),
          txClient.pettyCashReceipt.count({ where: { fundId: id } }),
          txClient.pettyCashExpense.count({ where: { fundId: id } }),
        ])
        if (tx + rc + ex > 0) return { error: "Reassign or remove entries in this fund first." }
        await txClient.fund.delete({ where: { id } })
        return undefined
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  } catch (e) {
    // P2034 = the Serializable transaction lost to a concurrent entry write that
    // referenced this fund. Surface the same "reassign first" message rather than
    // a 500 — the safe outcome, since a referencing row now exists.
    if (isP2034(e)) return { error: "Reassign or remove entries in this fund first." }
    throw e
  }
  if (result?.error) return result
  revalidateFunds()
}

// Existence/active check for an entry's fundId. Exported "use server" fn ⇒
// gate it (invariant). Create paths (default): reject a deactivated fund
// — the entry forms only offer active funds via getActiveFunds, so this
// closes the defense-in-depth gap where a crafted request could still tag a
// NEW entry to an isActive: false fund. Update paths pass
// `allowInactive: true` — existence-only, so editing a historical row whose
// fund was later deactivated still validates.
export async function validateFund(
  fundId: number,
  options?: { allowInactive?: boolean }
): Promise<boolean> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return false
  const fund = await prisma.fund.findUnique({
    where: { id: fundId },
    select: { id: true, isActive: true },
  })
  if (!fund) return false
  if (!options?.allowInactive && !fund.isActive) return false
  return true
}

export async function getActiveFunds(): Promise<{ id: number; name: string }[]> {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) return []
  return prisma.fund.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  })
}
