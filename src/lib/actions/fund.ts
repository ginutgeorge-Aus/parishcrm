"use server"

import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/lib/generated/prisma/client"
import { isAdmin, canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { isP2034, isP2002 } from "@/lib/validation"
import type { ActionResult } from "./types"
import { guardedAction, pgIdArg, formDataArg, prevStateArg } from "@/lib/guardedAction"

const FundSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  isActive: z.string().optional().transform((v) => v === "on"),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
})

/** Refresh the fund settings and fund report pages. */
function revalidateFunds() {
  revalidatePath("/accounting/settings/funds")
  revalidatePath("/accounting/reports/funds")
}

/** Create a fund. ADMIN only. */
export async function createFund(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guardedAction(
    { guard: isAdmin, feature: "accounting", args: z.tuple([prevStateArg, formDataArg]) },
    [_prev, formData],
    async ({ session }, [, formData]) => {
      const parsed = FundSchema.safeParse(Object.fromEntries(formData))
      if (!parsed.success) return { error: parsed.error.issues[0].message }
      const existing = await prisma.fund.findUnique({ where: { name: parsed.data.name } })
      if (existing) return { error: "A fund with this name already exists" }
      const created = await prisma.fund.create({ data: parsed.data })
      await logAudit(actorId(session), "FUND_CREATED", "Fund", created?.id, { name: parsed.data.name, isActive: parsed.data.isActive })
      revalidateFunds()
      redirect("/accounting/settings/funds")
    },
  )
}

/** Update a fund. ADMIN only. */
export async function updateFund(
  id: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  return guardedAction(
    { guard: isAdmin, feature: "accounting", args: z.tuple([pgIdArg, prevStateArg, formDataArg]) },
    [id, _prev, formData],
    async ({ session }, [id, , formData]) => {
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
      // Read the prior values in the same transaction as the write so the audit "before" can't be stale.
      // Serializable so a concurrent edit aborts one side (P2034) instead of being silently overwritten.
      let before: { name: string; isActive: boolean; sortOrder: number } | null
      try {
        before = await prisma.$transaction(async (tx) => {
          const current = await tx.fund.findUnique({ where: { id }, select: { name: true, isActive: true, sortOrder: true } })
          if (!current) return null
          await tx.fund.update({ where: { id }, data: parsed.data })
          return current
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (e) {
        if (isP2002(e)) return { error: "A fund with this name already exists" }
        if (isP2034(e)) return { error: "This fund was changed at the same time by someone else — try again." }
        throw e
      }
      if (!before) return { error: "Fund not found" }
      await logAudit(actorId(session), "FUND_UPDATED", "Fund", id, {
        before,
        after: { name: parsed.data.name, isActive: parsed.data.isActive, sortOrder: parsed.data.sortOrder },
      })
      revalidateFunds()
      redirect("/accounting/settings/funds")
    },
  )
}

/** Delete a fund. ADMIN only. */
export async function deleteFund(id: number): Promise<ActionResult> {
  return guardedAction(
    { guard: isAdmin, feature: "accounting", args: z.tuple([pgIdArg]) },
    [id],
    async ({ session }, [id]): Promise<ActionResult> => {
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
            const [tx, rc, ex, inv] = await Promise.all([
              txClient.transaction.count({ where: { fundId: id } }),
              txClient.pettyCashReceipt.count({ where: { fundId: id } }),
              txClient.pettyCashExpense.count({ where: { fundId: id } }),
              // Invoices' fundId is SET NULL on delete — count them so history isn't silently untagged.
              txClient.invoice.count({ where: { fundId: id } }),
            ])
            if (tx + rc + ex + inv > 0) return { error: "Reassign or remove entries in this fund first." }
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
      await logAudit(actorId(session), "FUND_DELETED", "Fund", id, { name: fund.name })
      revalidateFunds()
    },
  )
}

/** `validateFund` options: only the documented flag, nothing else. */
const ValidateFundOptions = z.object({ allowInactive: z.boolean().optional() }).strict().optional()

/**
 * Existence/active check for an entry's fundId. Exported "use server" fn ⇒ gate it (invariant).
 * Create paths (default): reject a deactivated fund — the entry forms only offer active funds via
 * getActiveFunds, so this closes the defense-in-depth gap where a crafted request could still tag a
 * NEW entry to an isActive: false fund. Update paths pass `allowInactive: true` — existence-only,
 * so editing a historical row whose fund was later deactivated still validates. ADMIN/PASTOR only.
 * A malformed id or options object is `false`, never a Prisma filter.
 */
export async function validateFund(
  fundId: number,
  options?: { allowInactive?: boolean }
): Promise<boolean> {
  return guardedAction(
    { guard: canAccessAccounting, feature: "accounting", args: z.tuple([pgIdArg, ValidateFundOptions]), denied: false },
    [fundId, options],
    async (_ctx, [fundId, options]) => {
      const fund = await prisma.fund.findUnique({
        where: { id: fundId },
        select: { id: true, isActive: true },
      })
      if (!fund) return false
      if (!options?.allowInactive && !fund.isActive) return false
      return true
    },
  )
}

/** List active funds. Accounting viewers only. */
export async function getActiveFunds(): Promise<{ id: number; name: string }[]> {
  return guardedAction(
    { guard: canViewAccounting, feature: "accounting", args: z.tuple([]), denied: [] },
    [],
    async () =>
      prisma.fund.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
  )
}
