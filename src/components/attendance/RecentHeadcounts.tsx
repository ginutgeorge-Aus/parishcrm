"use client"

import { Button } from "@/components/ui/button"
import { formatYMD } from "@/lib/attendance"
import type { RecentHeadcount } from "@/lib/attendanceQueries"

/**
 * Recent headcounts with edit and delete: a table at md+, cards below.
 * Edit loads the row into the entry form; delete is confirmed by the parent.
 */
export function RecentHeadcounts({
  rows,
  busy,
  onEdit,
  onDelete,
}: Readonly<{
  rows: RecentHeadcount[]
  busy: boolean
  onEdit: (row: RecentHeadcount) => void
  onDelete: (row: RecentHeadcount) => void
}>) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No headcounts recorded yet.</p>
  }
  const name = (r: RecentHeadcount) => `${r.serviceTypeName} ${formatYMD(r.date)}`
  const actions = (r: RecentHeadcount) => (
    <div className="flex gap-2">
      <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8" aria-label={`Edit ${name(r)}`} onClick={() => onEdit(r)}>
        Edit
      </Button>
      <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8" aria-label={`Delete ${name(r)}`} disabled={busy} onClick={() => onDelete(r)}>
        Delete
      </Button>
    </div>
  )
  return (
    <>
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{formatYMD(r.date)}</span>
              <span className="text-sm text-muted-foreground">{r.serviceTypeName}</span>
            </div>
            <p className="text-sm">
              {r.adults} adults + {r.children} children = <strong>{r.adults + r.children}</strong>
            </p>
            {r.notes && <p className="text-sm text-muted-foreground">{r.notes}</p>}
            {actions(r)}
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Date</th>
            <th className="py-2 pr-4 font-medium">Service</th>
            <th className="py-2 pr-4 text-right font-medium">Adults</th>
            <th className="py-2 pr-4 text-right font-medium">Children</th>
            <th className="py-2 pr-4 text-right font-medium">Total</th>
            <th className="py-2 pr-4 font-medium">Notes</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0">
              <td className="py-2 pr-4">{formatYMD(r.date)}</td>
              <td className="py-2 pr-4">{r.serviceTypeName}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{r.adults}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{r.children}</td>
              <td className="py-2 pr-4 text-right font-medium tabular-nums">{r.adults + r.children}</td>
              <td className="max-w-64 truncate py-2 pr-4 text-muted-foreground">{r.notes}</td>
              <td className="py-2">{actions(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
