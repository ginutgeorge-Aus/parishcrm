"use client"

import { useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ReconcileToggleButton } from "./ReconcileToggleButton"
import { reconcileMany } from "@/lib/actions/transactionReconcile"
import { fmtAUD } from "@/lib/formatting"

export type ReconcileRow = {
  id: number
  dateLabel: string
  description: string
  amount: number
  familyName: string | null
  type: "INCOME" | "EXPENSE"
  reconciled: boolean
  // Running book balance after this row (dollars), or null when the column is
  // not shown (no opening balance / filtered view / window predates opening).
  runningBalance: number | null
}

export function ReconcileTable({
  rows,
  userCanEdit,
  paymentAccountId,
  showRunningBalance,
}: {
  rows: ReconcileRow[]
  userCanEdit: boolean
  paymentAccountId: number
  showRunningBalance: boolean
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Only pending rows are bulk-selectable — reconciling an already-reconciled
  // row is a no-op, and un-reconcile stays a deliberate per-row action.
  const pendingIds = rows.filter((r) => !r.reconciled).map((r) => r.id)
  const pendingIdSet = new Set(pendingIds)
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every((id) => selected.has(id))
  // Intersect the stored selection with the IDs of the rows currently shown as
  // pending, so bulk actions never reach transactions outside this view.
  const scopedSelected = new Set([...selected].filter((id) => pendingIdSet.has(id)))

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allPendingSelected ? new Set() : new Set(pendingIds))
  }

  function reconcileSelected() {
    const ids = [...scopedSelected]
    if (ids.length === 0) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await reconcileMany(ids, paymentAccountId)
        if (result && "error" in result) {
          setError(result.error)
          return
        }
        // Server revalidated — reconciled rows re-render as reconciled; drop the
        // now-stale selection.
        setSelected(new Set())
      } catch {
        // Transport-level throw bypasses the {error} branch.
        setError("Something went wrong, try again")
      }
    })
  }

  const colCount = 6 + (showRunningBalance ? 1 : 0) + (userCanEdit ? 1 : 0)

  return (
    <div>
      {userCanEdit && scopedSelected.size > 0 && (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-xs">
          <span className="text-sm font-medium">
            {scopedSelected.size} selected
          </span>
          <Button size="sm" onClick={reconcileSelected} disabled={isPending}>
            {isPending ? "Reconciling…" : `Reconcile ${scopedSelected.size} selected`}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={isPending}>
            Clear
          </Button>
          {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
        </div>
      )}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
              {userCanEdit && (
                <th className="py-3 px-4 text-left font-medium">
                  <Checkbox
                    checked={allPendingSelected}
                    onCheckedChange={toggleAll}
                    disabled={pendingIds.length === 0}
                    aria-label="Select all pending"
                    className="cursor-pointer disabled:cursor-not-allowed"
                  />
                </th>
              )}
              <th className="py-3 px-4 text-left font-medium">Date</th>
              <th className="py-3 px-4 text-left font-medium">Description</th>
              <th className="py-3 px-4 text-right font-medium">Amount</th>
              {showRunningBalance && (
                <th className="py-3 px-4 text-right font-medium">Balance</th>
              )}
              <th className="py-3 px-4 text-left font-medium">Family</th>
              <th className="py-3 px-4 text-left font-medium">Type</th>
              <th className="py-3 px-4 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="py-16 text-center text-muted-foreground text-sm">
                  No transactions match this filter.
                </td>
              </tr>
            ) : (
              rows.map((tx) => (
                <tr key={tx.id} className="border-b border-border hover:bg-muted">
                  {userCanEdit && (
                    <td className="py-3 px-4">
                      {tx.reconciled ? (
                        <span className="inline-block w-4" />
                      ) : (
                        <Checkbox
                          checked={selected.has(tx.id)}
                          onCheckedChange={() => toggleOne(tx.id)}
                          aria-label={`Select ${tx.description}`}
                          className="cursor-pointer"
                        />
                      )}
                    </td>
                  )}
                  <td className="py-3 px-4 text-muted-foreground">{tx.dateLabel}</td>
                  <td className="py-3 px-4 max-w-xs truncate" title={tx.description}>{tx.description}</td>
                  <td className="py-3 px-4 text-right tabular">{fmtAUD(tx.amount)}</td>
                  {showRunningBalance && (
                    <td className="py-3 px-4 text-right tabular text-muted-foreground">
                      {tx.runningBalance === null ? "—" : fmtAUD(tx.runningBalance)}
                    </td>
                  )}
                  <td className="py-3 px-4 text-muted-foreground">{tx.familyName ?? "—"}</td>
                  <td className="py-3 px-4">
                    <Badge variant={tx.type === "INCOME" ? "default" : "secondary"}>
                      {tx.type === "INCOME" ? "Income" : "Expense"}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">
                    {userCanEdit ? (
                      // Key on reconciled so a server-side flip (bulk reconcile +
                      // revalidate) remounts the button with fresh optimistic state,
                      // rather than showing its stale initial value.
                      <ReconcileToggleButton
                        key={`${tx.id}-${tx.reconciled}`}
                        id={tx.id}
                        reconciled={tx.reconciled}
                        paymentAccountId={paymentAccountId}
                      />
                    ) : (
                      <Badge variant={tx.reconciled ? "default" : "outline"}>
                        {tx.reconciled ? "Reconciled" : "Pending"}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {rows.length === 0 ? (
          <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No transactions match this filter.
          </li>
        ) : (
          <>
          {userCanEdit && (
            <li className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <Checkbox
                checked={allPendingSelected}
                onCheckedChange={toggleAll}
                disabled={pendingIds.length === 0}
                aria-label="Select all pending"
                className="cursor-pointer disabled:cursor-not-allowed"
              />
              <span className="text-muted-foreground">Select all pending</span>
            </li>
          )}
          {rows.map((tx) => (
            <li key={tx.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                {userCanEdit && (
                  <div className="pt-0.5">
                    {tx.reconciled ? (
                      <span className="inline-block w-4" />
                    ) : (
                      <Checkbox
                        checked={selected.has(tx.id)}
                        onCheckedChange={() => toggleOne(tx.id)}
                        aria-label={`Select ${tx.description}`}
                        className="cursor-pointer"
                      />
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate" title={tx.description}>{tx.description}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{tx.dateLabel}</p>
                </div>
                <span className="shrink-0 tabular font-semibold whitespace-nowrap">
                  {fmtAUD(tx.amount)}
                </span>
              </div>
              {showRunningBalance && (
                <p className="mt-1 text-right text-xs tabular text-muted-foreground">
                  Balance: {tx.runningBalance === null ? "—" : fmtAUD(tx.runningBalance)}
                </p>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs text-muted-foreground">{tx.familyName ?? "—"}</span>
                <Badge variant={tx.type === "INCOME" ? "default" : "secondary"}>
                  {tx.type === "INCOME" ? "Income" : "Expense"}
                </Badge>
              </div>
              <div className="mt-2 flex items-center justify-end border-t pt-2">
                {userCanEdit ? (
                  <ReconcileToggleButton
                    key={`${tx.id}-${tx.reconciled}`}
                    id={tx.id}
                    reconciled={tx.reconciled}
                    paymentAccountId={paymentAccountId}
                  />
                ) : (
                  <Badge variant={tx.reconciled ? "default" : "outline"}>
                    {tx.reconciled ? "Reconciled" : "Pending"}
                  </Badge>
                )}
              </div>
            </li>
          ))}
          </>
        )}
      </ul>
    </div>
  )
}
