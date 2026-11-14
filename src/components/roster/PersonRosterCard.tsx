"use client"

import { useActionState, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { addPersonUnavailability, removePersonUnavailability } from "@/lib/actions/personUnavailability"
import { rotateRosterFeedToken } from "@/lib/actions/rosterFeed"
import type { ActionResultWithSuccess } from "@/lib/actions/types"

/** One saved unavailable range, as `YYYY-MM-DD` Sydney dates. */
export type UnavailableRow = { id: number; from: string; to: string }

const FIELD = "mt-1 block w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"

/** Person page "Roster" card: record unavailable dates and create/rotate the personal calendar link. */
export function PersonRosterCard({
  personId, rows, hasFeed,
}: Readonly<{ personId: number; rows: UnavailableRow[]; hasFeed: boolean }>) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<ActionResultWithSuccess, FormData>(
    async (prev, fd) => {
      const r = await addPersonUnavailability(personId, prev, fd)
      if (r && "success" in r) router.refresh()
      return r
    },
    undefined,
  )
  const [removing, startRemove] = useTransition()
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [feedPending, startFeed] = useTransition()
  const [feed, setFeed] = useState<{ url?: string; error?: string } | null>(null)

  /** Remove a range, surfacing any error, then refresh the list. */
  function remove(id: number) {
    setRemoveError(null)
    startRemove(async () => {
      try {
        const r = await removePersonUnavailability(id)
        if (r && "error" in r) setRemoveError(r.error)
        else router.refresh()
      } catch {
        setRemoveError("Could not remove. Please try again.")
      }
    })
  }

  /** Create or rotate the calendar link and show it once. */
  function rotate() {
    setFeed(null)
    startFeed(async () => {
      try {
        const r = await rotateRosterFeedToken(personId)
        setFeed("error" in r ? { error: r.error } : { url: r.url })
        if (!("error" in r)) router.refresh()
      } catch {
        setFeed({ error: "Could not create the link. Please try again." })
      }
    })
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Roster</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <section aria-labelledby="unavail-h" className="space-y-2">
          <h3 id="unavail-h" className="font-medium">Unavailable dates</h3>
          {rows.length === 0 ? (
            <p className="text-muted-foreground">No unavailable dates recorded.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span>{r.from === r.to ? r.from : `${r.from} to ${r.to}`}</span>
                  <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" disabled={removing} onClick={() => remove(r.id)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <FormFeedback state={{ error: removeError }} />
          <form action={formAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label htmlFor="unavail-from" className="font-medium">From</label>
              <input id="unavail-from" name="from" type="date" required className={FIELD} />
            </div>
            <div>
              <label htmlFor="unavail-to" className="font-medium">To (optional)</label>
              <input id="unavail-to" name="to" type="date" className={FIELD} />
            </div>
            <Button type="submit" className="min-h-11 sm:min-h-0" disabled={pending}>{pending ? "Saving…" : "Add"}</Button>
          </form>
          <FormFeedback state={state} />
        </section>

        <section aria-labelledby="feed-h" className="space-y-2">
          <h3 id="feed-h" className="font-medium">Calendar link</h3>
          <p className="text-muted-foreground">
            A private link this person adds to their phone calendar to see their roster. {hasFeed ? "Creating a new link stops the old one working." : "No link yet."}
          </p>
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" disabled={feedPending} onClick={rotate}>
            {feedPending ? "Working…" : hasFeed ? "Create new link" : "Create link"}
          </Button>
          {feed?.url && (
            <div className="space-y-1">
              <label htmlFor="feed-url" className="text-muted-foreground">Copy it now: it is not shown again.</label>
              <input id="feed-url" readOnly value={feed.url} onFocus={(e) => e.currentTarget.select()} className={`${FIELD} font-mono`} />
            </div>
          )}
          <FormFeedback state={{ error: feed?.error }} />
        </section>
      </CardContent>
    </Card>
  )
}
