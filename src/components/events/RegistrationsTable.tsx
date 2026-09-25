"use client"

import { useState, useTransition } from "react"
import { markPaid, cancelRegistration } from "@/lib/actions/registration"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { RegistrationDetailDialog } from "@/components/events/RegistrationDetailDialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fmtAUD } from "@/lib/formatting"
import { format } from "date-fns"

type Item = { quantity: number; ticketType: { name: string }; attendees: { name: string }[] }
type Reg = {
  id: number
  firstName: string
  lastName: string
  email: string
  phone: string | null
  totalAmount: number | string
  paymentStatus: string
  paymentRef: string | null
  createdAt: Date
  items: Item[]
}

// Card registrations are created by the Stripe webhook with a PaymentIntent id
// in paymentRef; bank-transfer / cash bookings have none.
function paymentMethod(paymentRef: string | null): string {
  return paymentRef ? "Card" : "Bank transfer"
}

type Props = { registrations: Reg[]; eventId: number; canEdit: boolean; total?: number }

const STATUS_COLOURS: Record<string, string> = {
  PAID: "bg-income/10 text-income",
  PENDING: "bg-gold/10 text-gold-foreground",
  CANCELLED: "bg-expense/10 text-expense",
}

// Per-row actions own their pending/error state so acting on one row never
// disables the buttons on every other row.
function RegistrationRowActions({ reg, eventId }: { reg: Reg; eventId: number }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        {reg.paymentStatus === "PENDING" && (
          <Button
            size="xs"
            variant="ghost"
            disabled={isPending}
            className="text-income hover:text-income"
            onClick={() => startTransition(async () => {
              setError(null)
              try {
                const result = await markPaid(reg.id, eventId)
                if (result?.error) setError(result.error)
              } catch {
                // A transport-level throw bypasses the {error} branch; surface a
                // retry message instead of silently reverting to idle.
                setError("Something went wrong, try again")
              }
            })}
          >
            Mark Paid
          </Button>
        )}
        {reg.paymentStatus !== "CANCELLED" && (
          <DeleteConfirmButton
            onConfirm={() => cancelRegistration(reg.id, eventId)}
            title="Cancel this registration?"
            description={`This cancels ${reg.firstName} ${reg.lastName}'s registration and cannot be undone from here.`}
            triggerLabel="Cancel"
            triggerSize="xs"
            triggerClassName="text-muted-foreground hover:text-destructive"
            confirmLabel="Cancel registration"
            pendingLabel="Cancelling…"
          />
        )}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function RegistrationsTable({ registrations, eventId, canEdit, total }: Props) {
  const [view, setView] = useState<"REGISTRATIONS" | "ATTENDEES">("REGISTRATIONS")
  const [filter, setFilter] = useState<"ALL" | "PAID" | "PENDING" | "CANCELLED">("ALL")
  const [detailId, setDetailId] = useState<number | null>(null)

  // "All" excludes cancelled — cancelled registrations only show under the Cancelled tab.
  const visible = filter === "ALL"
    ? registrations.filter(r => r.paymentStatus !== "CANCELLED")
    : registrations.filter(r => r.paymentStatus === filter)

  const attendees = visible.flatMap(reg =>
    reg.items.flatMap((item, itemIdx) => {
      const names = item.attendees.length > 0
        ? item.attendees.map(a => a.name)
        : Array<string>(item.quantity).fill("—")
      // Key by item index, not ticket-type name — two line items of the same
      // type would otherwise collide at the same attendee index.
      return names.map((name, idx) => ({
        key: `${reg.id}-${itemIdx}-${idx}`,
        name,
        ticketType: item.ticketType.name,
        bookedBy: `${reg.firstName} ${reg.lastName}`,
        paymentStatus: reg.paymentStatus,
      }))
    })
  )

  return (
    <div>
      {typeof total === "number" && total > registrations.length && (
        <p className="text-xs text-muted-foreground mb-4">
          Showing the newest {registrations.length} of {total} registrations. Export CSV for the full list.
        </p>
      )}
      <div className="flex gap-2 mb-4">
        {(["REGISTRATIONS", "ATTENDEES"] as const).map(v => (
          <Button
            key={v}
            size="sm"
            variant={view === v ? "default" : "outline"}
            onClick={() => setView(v)}
          >
            {v.charAt(0) + v.slice(1).toLowerCase()}
          </Button>
        ))}
      </div>

      <div className="flex gap-2 mb-4">
        {(["ALL", "PAID", "PENDING", "CANCELLED"] as const).map(f => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0) + f.slice(1).toLowerCase()}
          </Button>
        ))}
      </div>

      {view === "ATTENDEES" && (
        <>
        <div className="bg-card rounded-xl border border-border overflow-x-auto hidden md:block">
          <Table className="min-w-table">
            <TableHeader className="bg-muted">
              <TableRow>
                {["Name", "Ticket", "Booked by", "Status"].map(h => (
                  <TableHead key={h} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {attendees.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No attendees.</TableCell>
                </TableRow>
              )}
              {attendees.map(a => (
                <TableRow key={a.key} className={a.paymentStatus === "CANCELLED" ? "opacity-50" : ""}>
                  <TableCell className="font-semibold text-foreground">{a.name}</TableCell>
                  <TableCell className="text-muted-foreground">{a.ticketType}</TableCell>
                  <TableCell className="text-muted-foreground">{a.bookedBy}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_COLOURS[a.paymentStatus] ?? ""}>
                      {a.paymentStatus.charAt(0) + a.paymentStatus.slice(1).toLowerCase()}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile: card per attendee (avoids sideways table scroll) */}
        <ul className="space-y-2 md:hidden">
          {attendees.length === 0 && (
            <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              No attendees.
            </li>
          )}
          {attendees.map(a => (
            <li key={a.key} className={`rounded-lg border bg-card p-3 ${a.paymentStatus === "CANCELLED" ? "opacity-50" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">{a.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground truncate">{a.ticketType}</p>
                  <p className="text-xs text-muted-foreground truncate">{a.bookedBy}</p>
                </div>
                <Badge className={STATUS_COLOURS[a.paymentStatus] ?? ""}>
                  {a.paymentStatus.charAt(0) + a.paymentStatus.slice(1).toLowerCase()}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
        </>
      )}

      {view === "REGISTRATIONS" && (
      <>
      <div className="bg-card rounded-xl border border-border overflow-x-auto hidden md:block">
        <Table className="min-w-table-wide">
          <TableHeader className="bg-muted">
            <TableRow>
              {["Name", "Email", "Phone", "Tickets", "Amount", "Method", "Status", "Registered", "Actions"].map(h => (
                <TableHead key={h} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No registrations.</TableCell>
              </TableRow>
            )}
            {visible.map(reg => (
              <TableRow key={reg.id} className={reg.paymentStatus === "CANCELLED" ? "opacity-50" : ""}>
                <TableCell className="max-w-[16rem] truncate font-semibold" title={`${reg.firstName} ${reg.lastName}`}>
                  <button
                    type="button"
                    onClick={() => setDetailId(reg.id)}
                    className="text-left text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm truncate max-w-full"
                  >
                    {reg.firstName} {reg.lastName}
                  </button>
                </TableCell>
                <TableCell className="text-muted-foreground">{reg.email}</TableCell>
                <TableCell className="text-muted-foreground">{reg.phone ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  <div className="flex flex-col gap-0.5">
                    {reg.items.map((i, idx) => (
                      <div key={idx}>
                        <span className="font-medium text-muted-foreground">{i.quantity} {i.ticketType.name}</span>
                        {i.attendees.length > 0 && (
                          <span className="text-muted-foreground">: {i.attendees.map(a => a.name).join(", ")}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="tabular font-semibold text-foreground">
                  {fmtAUD(parseFloat(reg.totalAmount.toString()))}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {paymentMethod(reg.paymentRef)}
                </TableCell>
                <TableCell>
                  <Badge className={STATUS_COLOURS[reg.paymentStatus] ?? ""}>
                    {reg.paymentStatus.charAt(0) + reg.paymentStatus.slice(1).toLowerCase()}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {format(reg.createdAt, "d MMM yyyy")}
                </TableCell>
                <TableCell>
                  {canEdit && <RegistrationRowActions reg={reg} eventId={eventId} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: card per registration (avoids sideways table scroll) */}
      <ul className="space-y-2 md:hidden">
        {visible.length === 0 && (
          <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No registrations.
          </li>
        )}
        {visible.map(reg => (
          <li key={reg.id} className={`rounded-lg border bg-card p-3 ${reg.paymentStatus === "CANCELLED" ? "opacity-50" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => setDetailId(reg.id)}
                  className="text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm truncate max-w-full"
                >
                  {reg.firstName} {reg.lastName}
                </button>
                <p className="mt-0.5 text-xs text-muted-foreground truncate">{reg.email}</p>
                <p className="text-xs text-muted-foreground">{reg.phone ?? "—"}</p>
              </div>
              <span className="shrink-0 tabular font-semibold whitespace-nowrap text-foreground">
                {fmtAUD(parseFloat(reg.totalAmount.toString()))}
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
              {reg.items.map((i, idx) => (
                <div key={idx}>
                  <span className="font-medium text-muted-foreground">{i.quantity} {i.ticketType.name}</span>
                  {i.attendees.length > 0 && (
                    <span className="text-muted-foreground">: {i.attendees.map(a => a.name).join(", ")}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Badge className={STATUS_COLOURS[reg.paymentStatus] ?? ""}>
                {reg.paymentStatus.charAt(0) + reg.paymentStatus.slice(1).toLowerCase()}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {paymentMethod(reg.paymentRef)} · {format(reg.createdAt, "d MMM yyyy")}
              </span>
            </div>
            {canEdit && (
              <div className="mt-2 flex flex-wrap gap-2 border-t pt-2">
                <RegistrationRowActions reg={reg} eventId={eventId} />
              </div>
            )}
          </li>
        ))}
      </ul>
      </>
      )}

      {detailId !== null && (
        <RegistrationDetailDialog
          registrationId={detailId}
          open={detailId !== null}
          onOpenChange={(o) => { if (!o) setDetailId(null) }}
        />
      )}
    </div>
  )
}
