"use server"

import { z } from "zod"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/lib/generated/prisma/client"
import { isAdmin } from "@/lib/roleGuard"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { isValidPgId, isP2002, isP2034 } from "@/lib/validation"

const AccountGroupSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  type: z.enum(["INCOME", "EXPENSE"]),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
})

import type { ActionResult } from "./types"

export async function createAccountGroup(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = AccountGroupSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const existing = await prisma.accountGroup.findUnique({
    where: { name_type: { name: parsed.data.name, type: parsed.data.type } },
  })
  if (existing) return { error: "A group with this name already exists for this type" }

  // findUnique above is a TOCTOU — two concurrent creates on the same
  // name_type both pass it, so catch the P2002 and surface the same friendly
  // error instead of a raw 500.
  try {
    await prisma.accountGroup.create({ data: parsed.data })
  } catch (e) {
    if (isP2002(e)) return { error: "A group with this name already exists for this type" }
    throw e
  }
  revalidatePath("/accounting/accounts/groups")
  revalidatePath("/accounting/accounts")
  // Reports render group names/order, so refresh them too.
  revalidatePath("/accounting/reports/pl")
  revalidatePath("/accounting/reports/balance-sheet")
  redirect("/accounting/accounts/groups")
}

export async function updateAccountGroup(
  id: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid ID" }

  const parsed = AccountGroupSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const existing = await prisma.accountGroup.findUnique({ where: { id } })
  if (!existing) return { error: "Group not found" }

  const duplicate = await prisma.accountGroup.findUnique({
    where: { name_type: { name: parsed.data.name, type: parsed.data.type } },
  })
  if (duplicate && duplicate.id !== id) return { error: "A group with this name already exists for this type" }

  // Changing a group's type would relabel its linked accounts without changing
  // their own types, creating cross-type associations through a normal admin
  // workflow. Count linked accounts + update in one transaction so an
  // account assigned between the check and the write can't slip past the guard.
  // Same TOCTOU-on-@unique catch as create — the concurrent-rename P2002.
  let guardError: string | null
  try {
    guardError = await prisma.$transaction(async (tx) => {
      if (parsed.data.type !== existing.type) {
        const accountCount = await tx.account.count({ where: { groupId: id } })
        if (accountCount > 0) return "Cannot change group type while accounts are assigned to it"
      }
      await tx.accountGroup.update({ where: { id }, data: parsed.data })
      return null
    })
  } catch (e) {
    if (isP2002(e)) return { error: "A group with this name already exists for this type" }
    throw e
  }
  if (guardError) return { error: guardError }
  revalidatePath("/accounting/accounts/groups")
  revalidatePath("/accounting/accounts")
  // Reports render group names/order, so refresh them too.
  revalidatePath("/accounting/reports/pl")
  revalidatePath("/accounting/reports/balance-sheet")
  redirect("/accounting/accounts/groups")
}

export async function deleteAccountGroup(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid ID" }

  // Count + delete in one Serializable transaction, mirroring deleteFund
  //: Account.groupId is ON DELETE SET NULL, so an account inserted between
  // a separate count and delete would be silently un-grouped instead of blocking
  // the delete. Only Serializable closes that window — it aborts one side (P2034)
  // when a concurrent insert conflicts with the read.
  let blocked = false
  try {
    blocked = await prisma.$transaction(
      async (txClient) => {
        const accountCount = await txClient.account.count({ where: { groupId: id } })
        if (accountCount > 0) return true
        await txClient.accountGroup.delete({ where: { id } })
        return false
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  } catch (e) {
    // P2034 = lost to a concurrent account write referencing this group. Surface
    // the same "reassign first" message — the safe outcome, a referencing row now exists.
    if (isP2034(e)) return { error: "Reassign or delete accounts in this group first." }
    throw e
  }
  if (blocked) return { error: "Reassign or delete accounts in this group first." }

  revalidatePath("/accounting/accounts/groups")
  revalidatePath("/accounting/accounts")
  // Reports render group names/order, so refresh them too.
  revalidatePath("/accounting/reports/pl")
  revalidatePath("/accounting/reports/balance-sheet")
}
