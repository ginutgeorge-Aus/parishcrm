"use client"

import { useState, useEffect, useRef } from "react"
import { useActionState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ActionResult } from "@/lib/actions/types"
import { AccountType, TransactionType } from "@/lib/generated/prisma/enums"
import type { PaymentAccountLite } from "@/lib/paymentAccounts"
import { APP_CURRENCY } from "@/lib/appConfig"

type Account = { id: number; code: string; name: string; type: AccountType }
type Family = { id: number; name: string; people: { id: number; firstName: string; lastName: string }[] }
type Transaction = {
  id: number
  date: Date
  description: string
  amount: number | { toString(): string }
  type: TransactionType
  accountId: number
  paymentAccountId: number | null
  familyId: number | null
  personId: number | null
  reference: string | null
  notes: string | null
  // reconciled is intentionally NOT read here — the edit form used to
  // render a "Reconciled" checkbox that flipped it via the plain update path,
  // bypassing the ownership + balance guards the dedicated toggle/reconcile
  // actions enforce. Reconciling only happens on the transactions list /
  // reconciliation page now.
  fundId?: number | null
  // Last-seen version for optimistic concurrency. Serialized across the
  // RSC boundary as a Date or ISO string depending on Next's transport.
  updatedAt?: Date | string
}

// Use local time getters so the date input reflects the user's browser timezone
// rather than UTC (toISOString() would show yesterday before ~10am Sydney time).
function fmtDateInput(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function TransactionForm({
  action,
  transaction,
  accounts,
  families,
  funds,
  paymentAccounts,
}: {
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  transaction?: Transaction
  accounts: Account[]
  families: Family[]
  funds: { id: number; name: string }[]
  paymentAccounts: PaymentAccountLite[]
}) {
  const [state, formAction, isPending] = useActionState(action, undefined)

  const incomeAccounts = accounts.filter((a) => a.type === AccountType.INCOME)
  const expenseAccounts = accounts.filter((a) => a.type === AccountType.EXPENSE)

  const [selectedAccountId, setSelectedAccountId] = useState(
    transaction?.accountId ? String(transaction.accountId) : ""
  )
  // New entries preselect the account flagged Default (an active BANK account);
  // edits keep the row's own account. Without this the picker starts blank and
  // the "Default" flag never actually preselects a posting account.
  const defaultBankAccountId = paymentAccounts.find(
    (a) => a.kind === "BANK" && a.isDefault && a.isActive
  )?.id
  const [paymentAccountId, setPaymentAccountId] = useState<string>(
    transaction?.paymentAccountId
      ? String(transaction.paymentAccountId)
      : defaultBankAccountId != null
        ? String(defaultBankAccountId)
        : ""
  )
  // The caller passes ALL accounts (active + inactive, both kinds) so a
  // deactivated-but-still-referenced BANK account keeps rendering here — same
  // reasoning as the edit page's accountOptions for the category picker
  //. A row's own payment account might also be CASH-kind (a legacy
  // manual entry — PETTY_CASH is excluded from this form's own picker);
  // it renders via the disabled sentinel below instead of the normal list.
  const bankAccounts = paymentAccounts.filter((a) => a.kind === "BANK")
  const currentPaymentAccount = paymentAccounts.find((a) => String(a.id) === paymentAccountId)
  const [familyId, setFamilyId] = useState(transaction?.familyId ? String(transaction.familyId) : "")
  const [personId, setPersonId] = useState(transaction?.personId ? String(transaction.personId) : "")
  const generalFundId = funds.find((f) => f.name === "General")?.id
  // Edit mode must reflect the row's actual fundId — including genuinely null
  // (unassigned) — never fall back to General, or saving an untouched select
  // silently reassigns the transaction to General. The General default
  // only applies when creating a brand-new transaction (no `transaction` prop).
  const [fundId, setFundId] = useState(
    transaction
      ? transaction.fundId != null ? String(transaction.fundId) : ""
      : generalFundId != null ? String(generalFundId) : ""
  )

  const selectedFamily = families.find((f) => String(f.id) === familyId)

  // Type is derived from the selected account, not stored — keeping it in
  // useState + syncing via useEffect was a derived-state anti-pattern.
  // No account selected → fall back to the row's stored type (edit) or INCOME
  // (new), matching the prior useState default + early-return-in-effect.
  const selectedAccount = accounts.find((a) => String(a.id) === selectedAccountId)
  const derivedType = selectedAccount
    ? selectedAccount.type === AccountType.INCOME
      ? TransactionType.INCOME
      : TransactionType.EXPENSE
    : (transaction?.type ?? TransactionType.INCOME)

  // Clear the selected member only when the user actually CHANGES the family,
  // never on the initial mount — an unconditional reset here wiped the
  // pre-selected personId when editing an existing giving transaction, silently
  // unlinking the member on save.
  const familyIdRef = useRef(familyId)
  useEffect(() => {
    if (familyIdRef.current !== familyId) {
      familyIdRef.current = familyId
       
      setPersonId("")
    }
  }, [familyId])

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {state?.error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
          <p className="text-sm text-destructive">{state.error}</p>
          {/* Likely-duplicate warning: the button's own name/value pair
              is only included in the submitted FormData when it — not the main
              submit button — triggers the form, so re-submitting via the
              regular button never silently confirms a duplicate. */}
          {state.duplicateWarning && (
            <Button type="submit" name="confirmDuplicate" value="true" variant="outline" size="sm" disabled={isPending}>
              Post anyway
            </Button>
          )}
        </div>
      )}

      {/* Optimistic-concurrency token — the row's last-seen version, so
          the server can reject a save that would clobber a concurrent edit. */}
      {transaction?.updatedAt && (
        <input
          type="hidden"
          name="updatedAt"
          value={typeof transaction.updatedAt === "string" ? transaction.updatedAt : transaction.updatedAt.toISOString()}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            name="date"
            type="date"
            defaultValue={transaction ? fmtDateInput(transaction.date) : fmtDateInput(new Date())}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="amount">Amount ({APP_CURRENCY})</Label>
          <Input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={transaction ? Number(transaction.amount).toFixed(2) : ""}
            placeholder="0.00"
            required
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="description">Description</Label>
        <Input id="description" name="description" defaultValue={transaction?.description} required />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="account">Category</Label>
          <Select
            name="accountId"
            value={selectedAccountId}
            onValueChange={setSelectedAccountId}
          >
            <SelectTrigger id="account">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {incomeAccounts.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Income</SelectLabel>
                  {incomeAccounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.code} {a.name}</SelectItem>
                  ))}
                </SelectGroup>
              )}
              {expenseAccounts.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Expense</SelectLabel>
                  {expenseAccounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.code} {a.name}</SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="type">Type</Label>
          {/* Type is derived from the selected account, not user-editable — an
              editable control let the user contradict the account and hit a
              generic server error. Submit it via a hidden input. */}
          <input type="hidden" name="type" value={derivedType} />
          <div
            id="type"
            className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground"
            aria-readonly
          >
            {derivedType}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="fundId">Fund</Label>
        {/* Radix Select can't have a SelectItem with an empty value, so
            "unassigned" is a non-empty sentinel mapped back to "" here — same
            pattern as the familyId select below. */}
        <input type="hidden" name="fundId" value={fundId} />
        <Select value={fundId || "NONE"} onValueChange={(v: string) => setFundId(v === "NONE" ? "" : v)}>
          <SelectTrigger id="fundId" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">— unassigned —</SelectItem>
            {funds.map((f) => (
              <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="paymentAccount">Payment account</Label>
        <input type="hidden" name="paymentAccountId" value={paymentAccountId} />
        <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
          <SelectTrigger id="paymentAccount">
            <SelectValue placeholder="Select payment account" />
          </SelectTrigger>
          <SelectContent>
            {/* CASH-kind accounts excluded — petty cash rows enter the
                ledger only via petty-cash sessions, never manual entry. A
                CASH-kind row already on this transaction (blocked from editing
                server-side) still shows its value via a disabled sentinel. */}
            {currentPaymentAccount?.kind === "CASH" && (
              <SelectItem value={String(currentPaymentAccount.id)} disabled>
                {currentPaymentAccount.name} (managed by session)
              </SelectItem>
            )}
            {bankAccounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="familyId">
            Member family <span className="text-muted-foreground text-xs">(optional)</span>
            {familyId && <span className="ml-2 text-xs font-medium text-primary">· Giving transaction</span>}
          </Label>
          {/* Radix Select can't have a SelectItem with an empty value, so "no
              family" is a non-empty sentinel mapped back to "" here; the real
              form value is carried by the hidden input, not Select's own
              (unused) name prop. */}
          <input type="hidden" name="familyId" value={familyId} />
          <Select
            value={familyId || "NONE"}
            onValueChange={(v: string) => setFamilyId(v === "NONE" ? "" : v)}
          >
            <SelectTrigger id="familyId" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">— none —</SelectItem>
              {families.map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="personId">Member <span className="text-muted-foreground text-xs">(optional)</span></Label>
          <input type="hidden" name="personId" value={personId} />
          <Select
            value={personId || "NONE"}
            onValueChange={(v: string) => setPersonId(v === "NONE" ? "" : v)}
            disabled={!familyId}
          >
            <SelectTrigger id="personId" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">{familyId ? "— any member —" : "— select family first —"}</SelectItem>
              {selectedFamily?.people.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.firstName} {p.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="reference">Reference <span className="text-muted-foreground text-xs">(optional — cheque/envelope)</span></Label>
        <Input id="reference" name="reference" defaultValue={transaction?.reference ?? ""} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes">Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
        <Textarea id="notes" name="notes" defaultValue={transaction?.notes ?? ""} rows={2} />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : transaction ? "Save changes" : "Create transaction"}</Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/accounting/transactions">Cancel</Link>
        </Button>
      </div>
    </form>
  )
}
