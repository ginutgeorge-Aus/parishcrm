"use client"

import { useEffect, useState } from "react"
import { getRegistrationDetail, type RegistrationDetailDTO } from "@/lib/actions/registration"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { fmtAUD } from "@/lib/formatting"

type Props = { registrationId: number; open: boolean; onOpenChange: (open: boolean) => void }

const STATUS_COLOURS: Record<string, string> = {
  PAID: "bg-income/10 text-income",
  PENDING: "bg-gold/10 text-gold-foreground",
  CANCELLED: "bg-expense/10 text-expense",
}

function AnswerList({ answers }: { answers: { label: string; value: string }[] }) {
  if (answers.length === 0) return null
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
      {answers.map((a, i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{a.label}</dt>
          <dd className="text-foreground">{a.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function RegistrationDetailDialog({ registrationId, open, onOpenChange }: Props) {
  const [data, setData] = useState<RegistrationDetailDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false

    ;(async () => {
      setLoading(true); setError(null); setData(null)
      try {
        const res = await getRegistrationDetail(registrationId)
        if (cancelled) return
        if ("error" in res) setError(res.error)
        else setData(res.data)
      } catch {
        if (!cancelled) setError("Something went wrong, try again")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [open, registrationId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {data ? `${data.firstName} ${data.lastName}` : "Registration"}
          </DialogTitle>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground py-6">Loading…</p>}
        {error && <p role="alert" className="text-sm text-destructive py-6">{error}</p>}

        {data && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge className={STATUS_COLOURS[data.paymentStatus] ?? ""}>
                {data.paymentStatus.charAt(0) + data.paymentStatus.slice(1).toLowerCase()}
              </Badge>
              <span className="font-semibold text-foreground">{fmtAUD(data.totalAmount)}</span>
              <span className="text-muted-foreground">· {data.paymentMethod}</span>
            </div>

            <div className="text-sm">
              <p className="text-foreground">{data.email || "—"}</p>
              <p className="text-muted-foreground">{data.phone ?? "—"}</p>
            </div>

            {data.orderAnswers.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Answers</h3>
                <AnswerList answers={data.orderAnswers} />
              </section>
            )}

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Attendees · {data.attendees.length}
              </h3>
              {data.attendees.length === 0 && <p className="text-sm text-muted-foreground">No named attendees.</p>}
              <div className="flex flex-col gap-3">
                {data.attendees.map((a, i) => (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{a.name}</span>
                      <span className="text-xs text-muted-foreground">{a.ticketType}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {a.checkedIn ? "Checked in" : "Not checked in"}
                    </p>
                    {a.answers.length > 0 && <div className="mt-2"><AnswerList answers={a.answers} /></div>}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
