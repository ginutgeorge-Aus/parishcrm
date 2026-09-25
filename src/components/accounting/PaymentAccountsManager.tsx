"use client"

import { useState, useTransition, useActionState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FormFeedback } from "@/components/ui/FormFeedback"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  createPaymentAccount,
  renamePaymentAccount,
  setAccountActive,
  setDefaultAccount,
} from "@/lib/actions/paymentAccount"
import type { ActionResultWithSuccess } from "@/lib/actions/types"
import type { PaymentAccountLite } from "@/lib/paymentAccounts"

export function PaymentAccountsManager({ accounts }: { accounts: PaymentAccountLite[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Bank and cash accounts used across transactions, reconciliation, and reports.
        </p>
        <AddAccountDialog />
      </div>

      {/* Mobile card list */}
      <ul className="space-y-2 md:hidden">
        {accounts.length === 0 ? (
          <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No payment accounts yet.
          </li>
        ) : (
          accounts.map((a) => (
            <li key={a.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{a.name}</p>
                <Badge variant={a.kind === "BANK" ? "outline" : "secondary"}>
                  {a.kind === "BANK" ? "Bank" : "Cash"}
                </Badge>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Active</span>
                <ActiveToggle key={`${a.id}-${a.isActive}`} account={a} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Default</span>
                <DefaultButton key={`${a.id}-${a.isDefault}`} account={a} />
              </div>
              <div className="mt-2 flex justify-end border-t pt-2">
                <RenameAccountDialog account={a} />
              </div>
            </li>
          ))
        )}
      </ul>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Default</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  No payment accounts yet.
                </TableCell>
              </TableRow>
            ) : (
              accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>
                    <Badge variant={a.kind === "BANK" ? "outline" : "secondary"}>
                      {a.kind === "BANK" ? "Bank" : "Cash"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DefaultButton key={`${a.id}-${a.isDefault}`} account={a} />
                  </TableCell>
                  <TableCell>
                    <ActiveToggle key={`${a.id}-${a.isActive}`} account={a} />
                  </TableCell>
                  <TableCell>
                    <RenameAccountDialog account={a} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// Active switch — optimistic flip, reverted on a returned {error} or a
// transport-level throw, mirroring ReconcileToggleButton. The parent
// keys this on `${id}-${isActive}` so a server-side flip (revalidatePath after
// success) remounts fresh optimistic state instead of showing a stale value.
function ActiveToggle({ account }: { account: PaymentAccountLite }) {
  const [optimistic, setOptimistic] = useState(account.isActive)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleChange(next: boolean) {
    setOptimistic(next)
    setError(null)
    startTransition(async () => {
      try {
        const result = await setAccountActive(account.id, next)
        if (result && "error" in result) {
          setOptimistic(!next)
          setError(result.error)
        }
      } catch {
        setOptimistic(!next)
        setError("Something went wrong, try again")
      }
    })
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <Switch
        checked={optimistic}
        onCheckedChange={handleChange}
        disabled={isPending}
        aria-label={`${account.name} active`}
      />
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

// "Make default" — disabled for CASH accounts, the current default, or an
// inactive account (mirrors the server-side guard in setDefaultAccount). No
// optimistic flip needed — success revalidates the page and this account's
// row re-renders as the (now read-only) "Default" badge.
function DefaultButton({ account }: { account: PaymentAccountLite }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (account.isDefault) {
    return <Badge variant="default">Default</Badge>
  }

  const disabled = account.kind === "CASH" || !account.isActive

  function handleClick() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await setDefaultAccount(account.id)
        if (result && "error" in result) setError(result.error)
      } catch {
        setError("Something went wrong, try again")
      }
    })
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <Button variant="outline" size="sm" onClick={handleClick} disabled={disabled || isPending}>
        {isPending ? "Setting…" : "Make default"}
      </Button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

// The dialog shell owns only `open`; the form (useActionState + any local
// field state) lives in a child keyed on `formKey`, bumped each time the
// dialog opens. That forces a fresh mount per open — so a stale "Saved"
// message or leftover field value can never linger from the previous open —
// without an effect that calls setState off the action result (which would
// trip the cascading-render lint rule; c.f. FeedbackDialog/SendReceiptDialog,
// which reset state from the onOpenChange handler, never from an effect).
function RenameAccountDialog({ account }: { account: PaymentAccountLite }) {
  const [open, setOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setFormKey((k) => k + 1)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">Rename</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename account</DialogTitle>
        </DialogHeader>
        <RenameAccountForm key={formKey} account={account} />
      </DialogContent>
    </Dialog>
  )
}

function RenameAccountForm({ account }: { account: PaymentAccountLite }) {
  const renameAccount = renamePaymentAccount.bind(null, account.id)
  const [state, formAction, isPending] = useActionState<ActionResultWithSuccess, FormData>(
    renameAccount,
    undefined
  )

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />
      <div className="space-y-1">
        <Label htmlFor={`pa-rename-${account.id}`}>Name</Label>
        <Input
          id={`pa-rename-${account.id}`}
          name="name"
          maxLength={60}
          defaultValue={account.name}
          required
        />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save"}</Button>
      </DialogFooter>
    </form>
  )
}

function AddAccountDialog() {
  const [open, setOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setFormKey((k) => k + 1)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">Add account</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add payment account</DialogTitle>
          <DialogDescription>
            Bank accounts can be made the default. Only one active cash account is allowed.
          </DialogDescription>
        </DialogHeader>
        <AddAccountForm key={formKey} />
      </DialogContent>
    </Dialog>
  )
}

function AddAccountForm() {
  const [kind, setKind] = useState<"BANK" | "CASH" | "">("")
  const [state, formAction, isPending] = useActionState(createPaymentAccount, undefined)

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />
      <div className="space-y-1">
        <Label htmlFor="pa-name">Name</Label>
        <Input id="pa-name" name="name" maxLength={60} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pa-kind">Kind</Label>
        {/* Hidden-native-input pattern (name on Select root) — same as the
            paymentAccount select in TransactionForm.tsx. */}
        <Select name="kind" value={kind} onValueChange={(v) => setKind(v as "BANK" | "CASH")}>
          <SelectTrigger id="pa-kind" className="w-full">
            <SelectValue placeholder="Select kind" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BANK">Bank</SelectItem>
            <SelectItem value="CASH">Cash</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isPending}>{isPending ? "Adding…" : "Add account"}</Button>
      </DialogFooter>
    </form>
  )
}
