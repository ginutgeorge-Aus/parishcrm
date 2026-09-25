"use client"

import { useRouter } from "next/navigation"
import { useState, useActionState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"
import type { ActionResult } from "@/lib/actions/types"
import { APP_CURRENCY } from "@/lib/appConfig"

type Account = { id: number; code: string; name: string }
type Person = { id: number; firstName: string; lastName: string }
type Fund = { id: number; name: string }
type ReceiptDefaults = {
  amount: string
  accountId: string
  personId: string
  serviceTypeId: string
  notes: string
  fundId: string
}

export function ReceiptForm({
  action,
  accounts,
  persons,
  funds,
  receipt,
}: {
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  accounts: Account[]
  persons: Person[]
  funds: Fund[]
  receipt?: ReceiptDefaults
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(action, undefined)
  const [accountId, setAccountId] = useState(receipt?.accountId ?? "")
  const [personId, setPersonId] = useState(receipt?.personId ?? "")
  const [donorOpen, setDonorOpen] = useState(false)
  const generalFundId = funds.find((f) => f.name === "General")?.id
  // When editing, honour the stored fund even when it is "" (unassigned) — a
  // falsy check would silently re-default an unassigned receipt to General.
  // Only a NEW receipt (no `receipt`) defaults to General.
  const [fundId, setFundId] = useState(
    receipt
      ? receipt.fundId
      : generalFundId != null ? String(generalFundId) : ""
  )

  const selectedPerson = persons.find((p) => String(p.id) === personId)

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

      {/* Hidden input so personId is submitted with form */}
      <input type="hidden" name="personId" value={personId} />
      {/* Edit-only: form has no service-type field — preserve the existing value */}
      {receipt && <input type="hidden" name="serviceTypeId" value={receipt.serviceTypeId} />}

      {/* Date is not collected — server sets it to the session date */}
      <div className="space-y-1">
        <Label htmlFor="amount">Amount ({APP_CURRENCY})</Label>
        <Input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          defaultValue={receipt?.amount}
          required
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="accountId">Category</Label>
        <Select name="accountId" value={accountId} onValueChange={setAccountId} required>
          <SelectTrigger id="accountId">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.code} — {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="fundId">Fund</Label>
        {/* Radix Select can't have a SelectItem with an empty value, so
            "unassigned" is a non-empty sentinel mapped back to "" here — same
            pattern as TransactionForm's fund Select. */}
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
        <Label>
          Donor{" "}
          <span className="text-muted-foreground text-xs">(optional)</span>
        </Label>
        <Popover open={donorOpen} onOpenChange={setDonorOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={donorOpen}
              className="w-full justify-between font-normal"
            >
              {selectedPerson
                ? `${selectedPerson.firstName} ${selectedPerson.lastName}`
                : "Search donor…"}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0" align="start">
            <Command>
              <CommandInput placeholder="Type a name…" />
              <CommandList>
                <CommandEmpty>No person found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value=""
                    onSelect={() => { setPersonId(""); setDonorOpen(false) }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", personId === "" ? "opacity-100" : "opacity-0")} />
                    — none —
                  </CommandItem>
                  {persons.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${p.firstName} ${p.lastName}`}
                      onSelect={() => { setPersonId(String(p.id)); setDonorOpen(false) }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", personId === String(p.id) ? "opacity-100" : "opacity-0")} />
                      {p.firstName} {p.lastName}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes">
          Notes <span className="text-muted-foreground text-xs">(optional)</span>
        </Label>
        <Textarea id="notes" name="notes" rows={2} defaultValue={receipt?.notes} />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : receipt ? "Save changes" : "Add receipt"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
