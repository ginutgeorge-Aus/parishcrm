"use server"

import { auth } from "@/auth"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { Prisma } from "@/lib/generated/prisma/client"
import { isValidPgId, isP2002, isP2034 } from "@/lib/validation"

const CONFLICT_ERROR = "This account was changed at the same time by someone else — try again."

const AccountSchema = z.object({
  // Optional on create — blank auto-generates the next code for the type.
  code: z.string().max(20).optional().transform((v) => v?.trim() || undefined),
  name: z.string().min(1, "Name is required").max(200, "Name is too long"),
  type: z.enum(["INCOME", "EXPENSE"]),
  description: z.string().max(2000, "Description is too long").optional().transform((v) => v?.trim() || null),
  isActive: z.string().optional().transform((v) => v === "true"),
  groupId: z.coerce.number().int().min(1, "Select a group"),
})

import type { ActionResult } from "./types"

// Next free code in the type's range (INCOME 4xxx, EXPENSE 5xxx):
// max numeric code of that type + 1; non-numeric codes ignored.
async function nextCode(type: "INCOME" | "EXPENSE"): Promise<string> {
  const accounts = await prisma.account.findMany({
    where: { type },
    select: { code: true },
  })
  const base = type === "INCOME" ? 4000 : 5000
  const max = accounts
    .map((a) => Number.parseInt(a.code, 10))
    .filter((n) => !Number.isNaN(n))
    .reduce((m, n) => Math.max(m, n), base)
  return String(max + 1)
}

export async function createAccount(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = AccountSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const code = parsed.data.code ?? (await nextCode(parsed.data.type))

  const existing = await prisma.account.findUnique({ where: { code } })
  if (existing) return { error: "Account code already exists" }

  // Client-supplied FK: confirm the group exists before insert (security
  // checklist) — else a stale/forged groupId hits Postgres as an unhandled
  // P2003 500 instead of a clean validation error.
  const group = await prisma.accountGroup.findUnique({ where: { id: parsed.data.groupId }, select: { id: true, type: true } })
  if (!group) return { error: "Account group not found" }
  // Groups are typed (INCOME/EXPENSE); an account must match its group's type,
  // or a stale/forged submission attaches an income account to an expense group
  // and corrupts every report that buckets by group.
  if (group.type !== parsed.data.type) return { error: "Account type must match its group's type" }

  // The findUnique pre-check above is a TOCTOU: two concurrent creates on the
  // @unique code both pass it, so catch the P2002 and surface the same friendly
  // error instead of a raw 500 (matches createSession/ensureWeeklySession).
  try {
    await prisma.account.create({ data: { ...parsed.data, code, isActive: true } })
  } catch (e) {
    if (isP2002(e)) return { error: "Account code already exists" }
    throw e
  }
  revalidatePath("/accounting/accounts")
  redirect("/accounting/accounts")
}

export async function updateAccount(
  id: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid ID" }

  const parsed = AccountSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  // Auto-generation is create-only — edits must keep an explicit code.
  if (!parsed.data.code) return { error: "Code is required" }

  const target = await prisma.account.findUnique({ where: { id } })
  if (!target) return { error: "Account not found" }

  // Same FK guard as create — the update writes groupId too.
  const group = await prisma.accountGroup.findUnique({ where: { id: parsed.data.groupId }, select: { id: true, type: true } })
  if (!group) return { error: "Account group not found" }
  // An account must match its group's type — else a stale/forged edit lands an
  // income account in an expense group.
  if (group.type !== parsed.data.type) return { error: "Account type must match its group's type" }

  const existing = await prisma.account.findFirst({
    where: { code: parsed.data.code, NOT: { id } },
  })
  if (existing) return { error: "Account code already exists" }

  // Count + update run in one transaction so a transaction row created between
  // the check and the write can't slip past the type-change guard.
  // The findFirst pre-check above is a TOCTOU: two concurrent edits to the same
  // code both pass it, so catch the P2002 and surface the same friendly error
  // instead of a raw 500 — mirrors createAccount.
  //
  // Serializable (not just a transaction): createInvoice/updateInvoice validate the account's type and insert an
  // invoice in their own Serializable transaction. READ COMMITTED would let both commit — this count sees zero
  // invoices while the insert sees INCOME — leaving an invoice on a retyped account. Under Serializable each side
  // reads what the other writes (this one reads invoices and writes the account; the invoice write reads the account
  // and inserts an invoice), so Postgres aborts one with P2034. The retype loses safely ("invoices use it").
  let guardError: string | null
  try {
    guardError = await prisma.$transaction(async (tx) => {
      // Re-read the type inside the transaction: `target` was read before it, so a concurrent retype in between
      // would make the stale comparison skip the guards below.
      const current = await tx.account.findUnique({ where: { id }, select: { type: true } })
      if (!current) return "Account not found"
      if (parsed.data.type !== current.type) {
        const txCount = await tx.transaction.count({ where: { accountId: id } })
        if (txCount > 0) return "Cannot change account type while transactions exist"
        // Invoices post to an INCOME account; retyping would leave them on an invalid one.
        const invoiceCount = await tx.invoice.count({ where: { accountId: id } })
        if (invoiceCount > 0) return "Cannot change account type while invoices use it"
      }
      await tx.account.update({ where: { id }, data: parsed.data })
      return null
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (e) {
    if (isP2002(e)) return { error: "Account code already exists" }
    // Serializable conflict: a concurrent invoice write or a concurrent edit of this account won. Either way the
    // edit is rolled back; no auto-retry, since parsed.data may now be stale.
    if (isP2034(e)) return { error: CONFLICT_ERROR }
    throw e
  }
  if (guardError) return { error: guardError }

  revalidatePath("/accounting/accounts")
  redirect("/accounting/accounts")
}

/** Delete an unused account (ADMIN). The reference checks and the delete share one Serializable transaction. */
export async function deleteAccount(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid ID" }

  // Counts + delete in one Serializable transaction, mirroring deleteFund. Without it an invoice saved against this
  // account between the invoice count and the delete would hit an uncaught FK error (Invoice_accountId) instead of
  // a message. Serializable aborts one side with P2034 when a concurrent write references the account (the invoice
  // write reads the account row this delete removes; this delete reads the invoices that write inserts).
  // Transaction is not the only FK to Account — Budget, PettyCashReceipt and PettyCashExpense also reference
  // accountId; without these checks a delete throws an unhandled P2003 constraint error -> 500.
  let blocked: ActionResult
  try {
    blocked = await prisma.$transaction(async (tx) => {
      const [txCount, budgetCount, pcReceiptCount, pcExpenseCount, invoiceCount] = await Promise.all([
        tx.transaction.count({ where: { accountId: id } }),
        tx.budget.count({ where: { accountId: id } }),
        tx.pettyCashReceipt.count({ where: { accountId: id } }),
        tx.pettyCashExpense.count({ where: { accountId: id } }),
        tx.invoice.count({ where: { accountId: id } }),
      ])
      if (txCount > 0) return { error: `Cannot delete — ${txCount} transaction(s) linked to this account` }
      if (invoiceCount > 0) return { error: `Cannot delete — ${invoiceCount} invoice(s) linked to this account` }
      if (budgetCount > 0) return { error: `Cannot delete — ${budgetCount} budget(s) linked to this account` }
      if (pcReceiptCount + pcExpenseCount > 0) {
        return { error: `Cannot delete — ${pcReceiptCount + pcExpenseCount} petty-cash entr(ies) linked to this account` }
      }
      await tx.account.delete({ where: { id } })
      return undefined
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (e) {
    // Serializable conflict: the cause (a concurrent reference, or a false positive) can't be told apart, so the
    // message is generic. The delete is rolled back, the safe outcome.
    if (isP2034(e)) return { error: CONFLICT_ERROR }
    throw e
  }
  if (blocked) return blocked
  revalidatePath("/accounting/accounts")
}
