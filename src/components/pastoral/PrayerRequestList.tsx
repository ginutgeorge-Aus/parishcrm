"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { setPrayerRequestStatus, type PrayerRequestView } from "@/lib/actions/prayerRequest"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"
import type { PrayerRequestStatus } from "@/lib/generated/prisma/enums"
import { PRAYER_STATUS_LABEL } from "@/lib/pastoralLabels"

/**
 * Prayer requests with Answered / Archive / Restore per row. Rows stack on
 * phones. Requests are private (ADMIN | PASTOR); "OK to share" is shown as a
 * badge so staff see what the requester agreed to.
 */
export function PrayerRequestList({ requests }: Readonly<{ requests: PrayerRequestView[] }>) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  /**
   * Move a request to a new status and surface any error.
   * @param id PrayerRequest.id
   * @param status target status
   */
  function setStatus(id: number, status: PrayerRequestStatus) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await setPrayerRequestStatus(id, status)
        if (res && "error" in res) setError(res.error)
      } catch {
        setError("Something went wrong. Please try again.")
      }
    })
  }

  if (requests.length === 0) return <p className="text-sm text-muted-foreground">No prayer requests.</p>
  return (
    <div className="space-y-2">
      <FormFeedback state={{ error }} />
      <ul className="divide-y divide-border" aria-label="Prayer requests">
        {requests.map((r) => (
          <li key={r.id} className="space-y-1 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground">
                {r.createdAt.toLocaleDateString(APP_LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone: APP_TIMEZONE })}
              </span>
              <Badge variant="outline">{PRAYER_STATUS_LABEL[r.status]}</Badge>
              {r.source === "PUBLIC_FORM" && <Badge variant="secondary">Public form</Badge>}
              <Badge variant={r.shareConsent ? "secondary" : "outline"}>{r.shareConsent ? "OK to share" : "Private"}</Badge>
            </div>
            <p className="whitespace-pre-wrap">{r.request}</p>
            <Contact request={r} />
            <div className="flex flex-wrap gap-2 pt-1">
              {r.status === "ACTIVE" && (
                <Button size="sm" variant="outline" disabled={pending} className="min-h-11 sm:min-h-0" onClick={() => setStatus(r.id, "ANSWERED")}>
                  Mark answered
                </Button>
              )}
              {r.status === "ARCHIVED" || r.status === "ANSWERED" ? (
                <Button size="sm" variant="outline" disabled={pending} className="min-h-11 sm:min-h-0" onClick={() => setStatus(r.id, "ACTIVE")}>
                  Restore
                </Button>
              ) : null}
              {r.status !== "ARCHIVED" && (
                <Button size="sm" variant="ghost" disabled={pending} className="min-h-11 sm:min-h-0" onClick={() => setStatus(r.id, "ARCHIVED")}>
                  Archive
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Requester name, contact and linked member, when any are present. */
function Contact({ request: r }: Readonly<{ request: PrayerRequestView }>) {
  const parts = [r.requesterName, r.requesterEmail, r.requesterPhone].filter(Boolean)
  if (parts.length === 0 && !r.personId) return null
  return (
    <p className="text-muted-foreground">
      {parts.join(" · ")}
      {r.personId && r.personName && (
        <>
          {parts.length > 0 && " · "}
          <Link href={`/people/${r.personId}`} className="hover:underline">
            {r.personName}
          </Link>
        </>
      )}
    </p>
  )
}
