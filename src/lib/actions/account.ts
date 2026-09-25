"use server"

import { auth } from "@/auth"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { isValidPgId, isP2002 } from "@/lib/validation"

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
    .map((a) => parseInt(a.code, 10))
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
  let guardError: string | null
  try {
    guardError = await prisma.$transaction(async (tx) => {
      if (parsed.data.type !== target.type) {
        const txCount = await tx.transaction.count({ where: { accountId: id } })
        if (txCount > 0) return "Cannot change account type while transactions exist"
      }
      await tx.account.update({ where: { id }, data: parsed.data })
      return null
    })
  } catch (e) {
    if (isP2002(e)) return { error: "Account code already exists" }
    throw e
  }
  if (guardError) return { error: guardError }

  revalidatePath("/accounting/accounts")
  redirect("/accounting/accounts")
}

export async function deleteAccount(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid ID" }

  const txCount = await prisma.transaction.count({ where: { accountId: id } })
  if (txCount > 0) return { error: `Cannot delete — ${txCount} transaction(s) linked to this account` }

  // Transaction is not the only FK to Account — Budget, PettyCashReceipt and
  // PettyCashExpense also reference accountId. Without these checks a delete
  // throws an unhandled P2003 constraint error → 500.
  const [budgetCount, pcReceiptCount, pcExpenseCount] = await Promise.all([
    prisma.budget.count({ where: { accountId: id } }),
    prisma.pettyCashReceipt.count({ where: { accountId: id } }),
    prisma.pettyCashExpense.count({ where: { accountId: id } }),
  ])
  if (budgetCount > 0) return { error: `Cannot delete — ${budgetCount} budget(s) linked to this account` }
  if (pcReceiptCount + pcExpenseCount > 0) {
    return { error: `Cannot delete — ${pcReceiptCount + pcExpenseCount} petty-cash entr(ies) linked to this account` }
  }

  await prisma.account.delete({ where: { id } })
  revalidatePath("/accounting/accounts")
}
