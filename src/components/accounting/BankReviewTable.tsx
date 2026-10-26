"use client"

import { Fragment, useMemo, useState } from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { ReviewSummary } from "./import/ReviewSummary"
import { ReviewFilterTabs } from "./import/ReviewFilterTabs"
import { matchesFilter, needsCategory, reviewStats, type ReviewFilter } from "@/lib/bankReviewFilter"
import { toCents, isSplit } from "@/lib/bankSplit"
import type { SplitLine } from "@/lib/bankSplit"
import type { ReviewRow } from "@/lib/bankTypes"
export type { ReviewRow } from "@/lib/bankTypes"

// Monotonic client-side sequence for stable split-line React keys.
// Namespaced ("sk-") so a freshly-keyed line never collides with a legacy draft
// line that falls back to its array index.
let splitKeySeq = 0
const nextSplitKey = () => `sk-${++splitKeySeq}`

export type Account = { id: number; code: string; name: string; type: "INCOME" | "EXPENSE" }
type Person = { id: number; firstName: string; lastName: string; bankingName: string | null }
export type Family = { id: number; name: string; people: Person[] }

interface BankReviewTableProps {
  rows: ReviewRow[]
  period: { from: string; to: string } | null
  parseErrors: string[]
  accounts: Account[]
  families: Family[]
  importError: string | null
  importing: boolean
  onUpdateRow: (index: number, patch: Partial<ReviewRow>) => void
  /** `indices` = positions in `rows` of the rows visible in the active filter. */
  onSetAllCategory: (accountId: number, indices: number[]) => void
  onToggleSkipAll: (skip: boolean, indices: number[]) => void
  onConfirm: () => Promise<void>
  onBack: () => void
}

function MemberCombobox({
  families,
  personId,
  disabled,
  onSelect,
}: Readonly<{
  families: Family[]
  personId: number | null
  disabled: boolean
  onSelect: (personId: number | null) => void
}>) {
  const [open, setOpen] = useState(false)

  let selectedLabel = "— none —"
  for (const f of families) {
    const p = f.people.find((p) => p.id === personId)
    if (p) {
      selectedLabel = `${p.firstName} ${p.lastName} (${f.name})`
      break
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Member"
          disabled={disabled}
          className="w-full justify-between font-normal text-sm px-2 h-8"
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Type a name…" />
          <CommandList>
            <CommandEmpty>No member found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none__"
                onSelect={() => {
                  onSelect(null)
                  setOpen(false)
                }}
              >
                <Check className={cn("mr-2 h-4 w-4", personId === null ? "opacity-100" : "opacity-0")} />
                — none —
              </CommandItem>
              {families.map((f) =>
                f.people.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`${p.firstName} ${p.lastName} ${f.name} ${p.bankingName ?? ""} ${p.id}`}
                    onSelect={() => {
                      onSelect(p.id)
                      setOpen(false)
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", personId === p.id ? "opacity-100" : "opacity-0")} />
                    {p.firstName} {p.lastName} ({f.name})
                  </CommandItem>
                ))
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Import button shared by the header and footer so they can't drift apart. */
function ImportButton({
  count,
  disabled,
  importing,
  onClick,
}: Readonly<{ count: number; disabled: boolean; importing: boolean; onClick: () => void }>) {
  return (
    <Button onClick={onClick} disabled={disabled || importing}>
      {importing ? "Importing…" : `Import ${count} transaction${count !== 1 ? "s" : ""}`}
    </Button>
  )
}

export function BankReviewTable({
  rows,
  period,
  parseErrors,
  accounts,
  families,
  importError,
  importing,
  onUpdateRow,
  onSetAllCategory,
  onToggleSkipAll,
  onConfirm,
  onBack,
}: Readonly<BankReviewTableProps>) {
  const activeRows = rows.filter((r) => !r.skip)
  const canImport = activeRows.length > 0 && !rows.some(needsCategory)
  const [filter, setFilter] = useState<ReviewFilter>("all")
  // Rows edited while a filter is active stay visible until the filter changes,
  // so a row doesn't vanish from "Needs category" the moment it's categorised.
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set())
  const isVisible = (row: ReviewRow) => matchesFilter(row, filter) || pinned.has(row.bankRef)
  const visibleIndices = rows.flatMap((r, i) => (isVisible(r) ? [i] : []))

  /** Switch tabs and drop the sticky rows. */
  function changeFilter(f: ReviewFilter) {
    setFilter(f)
    setPinned(new Set())
  }

  /** Forward a row edit, pinning the row if it is currently shown by the filter. */
  function updateRow(index: number, patch: Partial<ReviewRow>) {
    const row = rows[index]
    if (row && filter !== "all" && matchesFilter(row, filter) && !pinned.has(row.bankRef)) {
      setPinned((prev) => new Set(prev).add(row.bankRef))
    }
    onUpdateRow(index, patch)
  }
  const stats = useMemo(() => reviewStats(rows), [rows])

  function startSplit(i: number, row: ReviewRow) {
    updateRow(i, {
      splits: [{ accountId: row.accountId, familyId: row.familyId, personId: row.personId, amount: row.amount, _key: nextSplitKey() }],
    })
  }

  function clearSplit(i: number) {
    updateRow(i, { splits: undefined })
  }

  function patchSplit(row: ReviewRow, i: number, j: number, patch: Partial<SplitLine>) {
    const splits = (row.splits ?? []).map((s, k) => (k === j ? { ...s, ...patch } : s))
    updateRow(i, { splits })
  }

  function selectSplitMember(row: ReviewRow, i: number, j: number, pid: number | null) {
    if (pid === null) {
      patchSplit(row, i, j, { personId: null, familyId: null })
      return
    }
    const family = families.find((f) => f.people.some((p) => p.id === pid))
    patchSplit(row, i, j, { personId: pid, familyId: family?.id ?? null })
  }

  function addSplitLine(row: ReviewRow, i: number) {
    const allocated = (row.splits ?? []).reduce((t, s) => t + toCents(s.amount), 0)
    const remainingCents = toCents(row.amount) - allocated
    const amount = remainingCents > 0 ? (remainingCents / 100).toFixed(2) : "0.00"
    updateRow(i, { splits: [...(row.splits ?? []), { accountId: null, familyId: null, personId: null, amount, _key: nextSplitKey() }] })
  }

  function removeSplitLine(row: ReviewRow, i: number, j: number) {
    const splits = (row.splits ?? []).filter((_, k) => k !== j)
    updateRow(i, { splits: splits.length ? splits : undefined })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            Review Transactions
            {period && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {period.from} to {period.to}
              </span>
            )}
          </h3>
          <p className="text-sm text-muted-foreground">
            {rows.length} transactions found
          </p>
        </div>
        <div className="flex items-center gap-2">
          {importError && <p className="text-sm text-destructive">{importError}</p>}
          <Button variant="outline" onClick={onBack}>
            ← Back
          </Button>
          <ImportButton count={activeRows.length} disabled={!canImport} importing={importing} onClick={onConfirm} />
        </div>
      </div>

      <ReviewSummary stats={stats} />
      <ReviewFilterTabs value={filter} stats={stats} onChange={changeFilter} />

      {parseErrors.length > 0 && (
        <p className="text-sm text-warning">
          {parseErrors.length} parse warning(s): {parseErrors[0]}
        </p>
      )}

      <div className="flex items-center gap-4 text-sm">
        <span className="font-medium text-muted-foreground">Set all:</span>
        {/* Controlled at "" so the placeholder always returns and re-selecting
            the same category still fires onValueChange. */}
        <Select value="" onValueChange={(v: string) => onSetAllCategory(Number(v), visibleIndices)}>
          <SelectTrigger id="bank-set-all" className="w-56">
            <SelectValue placeholder="— category —" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Income</SelectLabel>
              {accounts.filter((a) => a.type === "INCOME").map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Expenses</SelectLabel>
              {accounts.filter((a) => a.type === "EXPENSE").map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <button
          className="min-h-11 min-w-11 px-2 py-1 text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => onToggleSkipAll(true, visibleIndices)}
        >
          Skip all
        </button>
        <button
          className="min-h-11 min-w-11 px-2 py-1 text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => onToggleSkipAll(false, visibleIndices)}
        >
          Include all
        </button>
      </div>

      <div className="hidden md:block border rounded-md overflow-x-auto">
        <Table aria-label="Bank statement lines">
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-32 text-right">Amount</TableHead>
              <TableHead className="w-52">Category</TableHead>
              <TableHead className="w-44">Member</TableHead>
              <TableHead className="w-32 text-center">Cash Transfer</TableHead>
              <TableHead className="w-16 text-center">Skip</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 && visibleIndices.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                  No rows match this filter
                </TableCell>
              </TableRow>
            )}
            {rows.map((row, i) => {
              if (!isVisible(row)) return null
              const split = isSplit(row)
              const allocatedCents = (row.splits ?? []).reduce((t, s) => t + toCents(s.amount), 0)
              const remainingCents = toCents(row.amount) - allocatedCents
              return (
              <Fragment key={row.bankRef}>
              <TableRow
                className={cn(
                  row.skip ? "opacity-40" : row.fromPettyCash ? "bg-info/10" : i % 2 === 1 && "bg-muted/30"
                )}
              >
                <TableCell className="text-sm font-medium">{row.date}</TableCell>
                <TableCell className="text-sm">
                  <div className="font-semibold">{row.description}</div>
                  {(() => {
                    const extra = row.details.startsWith(row.description + " | ")
                      ? row.details.slice(row.description.length + 3)
                      : row.details !== row.description && row.details
                        ? row.details
                        : null
                    return extra ? (
                      <div className="text-xs text-muted-foreground mt-0.5">{extra}</div>
                    ) : null
                  })()}
                  {row.isDuplicate && (
                    <Badge variant="secondary" className="text-xs mt-0.5">
                      DUPLICATE
                    </Badge>
                  )}
                  {row.isPossibleDuplicate && !row.isDuplicate && (
                    <Badge variant="outline" className="text-xs mt-0.5 border-warning text-warning">
                      POSSIBLE DUPLICATE
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular text-sm">
                  {row.ambiguousType && !row.skip ? (
                    <div className="space-y-1">
                      <div className="tabular font-semibold">${row.amount}</div>
                      <Select
                        value=""
                        onValueChange={(v: string) =>
                          updateRow(i, {
                            type: v as "INCOME" | "EXPENSE",
                            ambiguousType: false,
                          })
                        }
                      >
                        <SelectTrigger
                          className="w-full border-warning/40 bg-warning/10 text-warning"
                          aria-label="Set transaction direction"
                          aria-invalid
                        >
                          <SelectValue placeholder="Deposit or withdrawal?" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="INCOME">Deposit (+)</SelectItem>
                          <SelectItem value="EXPENSE">Withdrawal (−)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <span className={cn("font-semibold", row.type === "INCOME" ? "text-income" : "text-expense")}>
                      {row.type === "INCOME" ? "+" : "-"}${row.amount}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {row.fromPettyCash ? (
                    <div className="w-full text-sm border rounded px-2 py-1 bg-info/10 text-info border-info/30 flex items-center gap-1">
                      <span>🔒</span> Internal Transfer
                    </div>
                  ) : split ? (
                    <div className="text-sm">
                      <span className="font-medium">Split into {row.splits!.length}</span>
                      <div className={cn("text-xs", remainingCents === 0 ? "text-muted-foreground" : "text-destructive")}>
                        {Number.isNaN(remainingCents)
                          ? "enter a valid amount for each split"
                          : remainingCents === 0
                            ? "fully allocated"
                            : `${(remainingCents / 100).toFixed(2)} unallocated`}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Select
                        value={row.accountId !== null ? String(row.accountId) : ""}
                        disabled={row.skip}
                        onValueChange={(v: string) => updateRow(i, { accountId: v ? Number(v) : null })}
                      >
                        <SelectTrigger
                          className={cn(
                            "w-full",
                            // Flag rows that will block import: active (not skipped) with no category.
                            !row.skip && row.accountId === null &&
                              "border-destructive bg-destructive/10 text-destructive"
                          )}
                          aria-invalid={!row.skip && row.accountId === null}
                        >
                          <SelectValue placeholder="Select category…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>{row.type === "INCOME" ? "Income" : "Expenses"}</SelectLabel>
                            {accounts.filter((a) => a.type === row.type).map((a) => (
                              <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                        disabled={row.skip}
                        onClick={() => startSplit(i, row)}
                      >
                        Split…
                      </button>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {split ? (
                    <span className="text-muted-foreground text-sm">per line ↓</span>
                  ) : (
                    <MemberCombobox
                      families={families}
                      personId={row.personId}
                      disabled={row.skip}
                      onSelect={(pid) => {
                        if (pid === null) {
                          updateRow(i, { personId: null, familyId: null })
                          return
                        }
                        const family = families.find((f) => f.people.some((p) => p.id === pid))
                        updateRow(i, { personId: pid, familyId: family?.id ?? null })
                      }}
                    />
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {split ? (
                    <span className="text-muted-foreground text-sm">—</span>
                  ) : row.type === "INCOME" ? (
                    <div className="flex flex-col items-center gap-1">
                      <label
                        className={cn(
                          "inline-flex items-center justify-center p-3.5",
                          row.skip ? "cursor-not-allowed" : "cursor-pointer"
                        )}
                      >
                        <Checkbox
                          aria-label="Mark as petty cash transfer"
                          checked={row.fromPettyCash}
                          disabled={row.skip}
                          onCheckedChange={(c: boolean | "indeterminate") => updateRow(i, { fromPettyCash: c === true })}
                        />
                      </label>
                      {row.fromPettyCash && (
                        <span className="text-xs text-primary/80 dark:text-primary/80 font-medium">from petty cash</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  <label className="inline-flex items-center justify-center p-3.5 cursor-pointer">
                    <Checkbox
                      aria-label="Skip this transaction"
                      checked={row.skip}
                      onCheckedChange={(c: boolean | "indeterminate") => updateRow(i, { skip: c === true })}
                    />
                  </label>
                </TableCell>
              </TableRow>
              {split && !row.skip && (
                <TableRow className="bg-muted/40">
                  <TableCell colSpan={7} className="py-3">
                    <div className="space-y-2 pl-2">
                      {row.splits!.map((s, j) => (
                        // Stable per-line key so removing an earlier line doesn't
                        // shift a still-open member popover onto the wrong line
                        //. Legacy drafts without `_key` fall back to index.
                        <div key={s._key ?? j} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-4 text-right">{j + 1}.</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`Split ${j + 1} amount`}
                            className="w-24 text-sm border rounded px-2 py-1 bg-background tabular text-right"
                            value={s.amount}
                            onChange={(e) => {
                              // Reject non-numeric keystrokes so a mistype can't reach
                              // toCents() and render "NaN unallocated".
                              const v = e.target.value
                              if (v === "" || /^\d*\.?\d{0,2}$/.test(v)) patchSplit(row, i, j, { amount: v })
                            }}
                          />
                          <Select
                            value={s.accountId !== null ? String(s.accountId) : ""}
                            onValueChange={(v: string) =>
                              patchSplit(row, i, j, { accountId: v ? Number(v) : null })
                            }
                          >
                            <SelectTrigger
                              aria-label={`Split ${j + 1} category`}
                              className={cn(
                                "w-52",
                                s.accountId === null && "border-destructive bg-destructive/10 text-destructive"
                              )}
                            >
                              <SelectValue placeholder="Select category…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectLabel>{row.type === "INCOME" ? "Income" : "Expenses"}</SelectLabel>
                                {accounts.filter((a) => a.type === row.type).map((a) => (
                                  <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <div className="w-44">
                            <MemberCombobox
                              families={families}
                              personId={s.personId}
                              disabled={false}
                              onSelect={(pid) => selectSplitMember(row, i, j, pid)}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove split ${j + 1}`}
                            className="min-h-11 min-w-11 text-muted-foreground hover:text-destructive"
                            onClick={() => removeSplitLine(row, i, j)}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      ))}
                      <div className="flex items-center gap-4 text-xs pl-6">
                        <button
                          type="button"
                          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          onClick={() => addSplitLine(row, i)}
                        >
                          + Add line
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          onClick={() => clearSplit(i)}
                        >
                          Remove split
                        </button>
                        <span className={cn("tabular", remainingCents === 0 ? "text-muted-foreground" : "text-destructive")}>
                          allocated {(allocatedCents / 100).toFixed(2)} / {row.amount}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: card per row (avoids sideways table scroll) */}
      <ul className="space-y-2 md:hidden">
        {rows.length === 0 && (
          <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No transactions found
          </li>
        )}
        {rows.length > 0 && visibleIndices.length === 0 && (
          <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No rows match this filter
          </li>
        )}
        {rows.map((row, i) => {
          if (!isVisible(row)) return null
          const split = isSplit(row)
          const allocatedCents = (row.splits ?? []).reduce((t, s) => t + toCents(s.amount), 0)
          const remainingCents = toCents(row.amount) - allocatedCents
          return (
            <li
              key={row.bankRef}
              className={cn(
                "rounded-lg border bg-card p-3 space-y-2",
                row.skip ? "opacity-40" : row.fromPettyCash ? "bg-info/10" : ""
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{row.date}</p>
                  <p className="font-semibold text-sm">{row.description}</p>
                  {(() => {
                    const extra = row.details.startsWith(row.description + " | ")
                      ? row.details.slice(row.description.length + 3)
                      : row.details !== row.description && row.details
                        ? row.details
                        : null
                    return extra ? (
                      <div className="text-xs text-muted-foreground mt-0.5">{extra}</div>
                    ) : null
                  })()}
                  {row.isDuplicate && (
                    <Badge variant="secondary" className="text-xs mt-0.5">
                      DUPLICATE
                    </Badge>
                  )}
                  {row.isPossibleDuplicate && !row.isDuplicate && (
                    <Badge variant="outline" className="text-xs mt-0.5 border-warning text-warning">
                      POSSIBLE DUPLICATE
                    </Badge>
                  )}
                </div>
                <span className={cn(
                  "shrink-0 tabular text-sm font-semibold whitespace-nowrap",
                  !row.ambiguousType && (row.type === "INCOME" ? "text-income" : "text-expense")
                )}>
                  {row.ambiguousType && !row.skip ? `$${row.amount}` : `${row.type === "INCOME" ? "+" : "-"}$${row.amount}`}
                </span>
              </div>

              {row.ambiguousType && !row.skip && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Direction</p>
                  <Select
                    value=""
                    onValueChange={(v: string) =>
                      updateRow(i, {
                        type: v as "INCOME" | "EXPENSE",
                        ambiguousType: false,
                      })
                    }
                  >
                    <SelectTrigger
                      className="w-full border-warning/40 bg-warning/10 text-warning"
                      aria-label="Set transaction direction"
                      aria-invalid
                    >
                      <SelectValue placeholder="Deposit or withdrawal?" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INCOME">Deposit (+)</SelectItem>
                      <SelectItem value="EXPENSE">Withdrawal (−)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {row.fromPettyCash ? (
                <div className="w-full text-sm border rounded px-2 py-1 bg-info/10 text-info border-info/30 flex items-center gap-1">
                  <span>🔒</span> Internal Transfer
                </div>
              ) : split ? (
                <div className="text-sm">
                  <span className="font-medium">Split into {row.splits!.length}</span>
                  <div className={cn("text-xs", remainingCents === 0 ? "text-muted-foreground" : "text-destructive")}>
                    {Number.isNaN(remainingCents)
                      ? "enter a valid amount for each split"
                      : remainingCents === 0
                        ? "fully allocated"
                        : `${(remainingCents / 100).toFixed(2)} unallocated`}
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Category</p>
                  <Select
                    value={row.accountId !== null ? String(row.accountId) : ""}
                    disabled={row.skip}
                    onValueChange={(v: string) => updateRow(i, { accountId: v ? Number(v) : null })}
                  >
                    <SelectTrigger
                      className={cn(
                        "w-full",
                        !row.skip && row.accountId === null &&
                          "border-destructive bg-destructive/10 text-destructive"
                      )}
                      aria-invalid={!row.skip && row.accountId === null}
                    >
                      <SelectValue placeholder="Select category…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>{row.type === "INCOME" ? "Income" : "Expenses"}</SelectLabel>
                        {accounts.filter((a) => a.type === row.type).map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    className="mt-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                    disabled={row.skip}
                    onClick={() => startSplit(i, row)}
                  >
                    Split…
                  </button>
                </div>
              )}

              {!split && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Member</p>
                  <MemberCombobox
                    families={families}
                    personId={row.personId}
                    disabled={row.skip}
                    onSelect={(pid) => {
                      if (pid === null) {
                        updateRow(i, { personId: null, familyId: null })
                        return
                      }
                      const family = families.find((f) => f.people.some((p) => p.id === pid))
                      updateRow(i, { personId: pid, familyId: family?.id ?? null })
                    }}
                  />
                </div>
              )}

              {split && !row.skip && (
                <div className="space-y-2 border-t pt-2">
                  {row.splits!.map((s, j) => (
                    <div key={s._key ?? j} className="space-y-1 rounded border p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Split {j + 1}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove split ${j + 1}`}
                          className="min-h-11 min-w-11 text-muted-foreground hover:text-destructive"
                          onClick={() => removeSplitLine(row, i, j)}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Amount</p>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Split ${j + 1} amount`}
                          className="w-full text-sm border rounded px-2 py-1 bg-background tabular"
                          value={s.amount}
                          onChange={(e) => {
                            const v = e.target.value
                            if (v === "" || /^\d*\.?\d{0,2}$/.test(v)) patchSplit(row, i, j, { amount: v })
                          }}
                        />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Category</p>
                        <Select
                          value={s.accountId !== null ? String(s.accountId) : ""}
                          onValueChange={(v: string) =>
                            patchSplit(row, i, j, { accountId: v ? Number(v) : null })
                          }
                        >
                          <SelectTrigger
                            aria-label={`Split ${j + 1} category`}
                            className={cn(
                              "w-full",
                              s.accountId === null && "border-destructive bg-destructive/10 text-destructive"
                            )}
                          >
                            <SelectValue placeholder="Select category…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel>{row.type === "INCOME" ? "Income" : "Expenses"}</SelectLabel>
                              {accounts.filter((a) => a.type === row.type).map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Member</p>
                        <MemberCombobox
                          families={families}
                          personId={s.personId}
                          disabled={false}
                          onSelect={(pid) => selectSplitMember(row, i, j, pid)}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center gap-4 text-xs">
                    <button
                      type="button"
                      className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => addSplitLine(row, i)}
                    >
                      + Add line
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => clearSplit(i)}
                    >
                      Remove split
                    </button>
                  </div>
                  <div className={cn("tabular text-xs", remainingCents === 0 ? "text-muted-foreground" : "text-destructive")}>
                    allocated {(allocatedCents / 100).toFixed(2)} / {row.amount}
                  </div>
                </div>
              )}

              {!split && row.type === "INCOME" && (
                <div>
                  <label
                    className={cn(
                      "inline-flex items-center gap-2",
                      row.skip ? "cursor-not-allowed" : "cursor-pointer"
                    )}
                  >
                    <Checkbox
                      aria-label="Mark as petty cash transfer"
                      checked={row.fromPettyCash}
                      disabled={row.skip}
                      onCheckedChange={(c: boolean | "indeterminate") => updateRow(i, { fromPettyCash: c === true })}
                    />
                    <span className="text-sm">
                      Cash transfer
                      {row.fromPettyCash && (
                        <span className="ml-1 text-xs text-primary/80 font-medium">(from petty cash)</span>
                      )}
                    </span>
                  </label>
                </div>
              )}

              <div className="border-t pt-2">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    aria-label="Skip this transaction"
                    checked={row.skip}
                    onCheckedChange={(c: boolean | "indeterminate") => updateRow(i, { skip: c === true })}
                  />
                  <span className="text-sm text-muted-foreground">Skip this transaction</span>
                </label>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-sm text-muted-foreground">
          {stats.needsCategory > 0
            ? `${stats.needsCategory} row${stats.needsCategory === 1 ? "" : "s"} still need${stats.needsCategory === 1 ? "s" : ""} a category`
            : "All rows ready"}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {importError && <p role="alert" className="text-sm text-destructive">{importError}</p>}
          <ImportButton count={activeRows.length} disabled={!canImport} importing={importing} onClick={onConfirm} />
        </div>
      </div>
    </div>
  )
}
