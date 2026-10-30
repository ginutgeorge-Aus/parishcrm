"use client"

import { useActionState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { OrganizersEditor } from "./OrganizersEditor"
import type { Organizer } from "@/lib/eventOrganizers"
import type { ActionResult } from "@/lib/actions/types"
import { CATEGORIES, RECURS_OPTIONS } from "@/lib/eventConstants"

type Props = {
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  /** Stored event kind — decides which schedule fields show; never submitted. */
  kind: "one_off" | "recurring"
  defaultValues: {
    slug: string
    title: string
    description: string
    category: string
    date: string
    endDate: string
    recurs: string
    recursLabel: string
    startTime: string
    location: string
    hasBanner: boolean
    hasPoster: boolean
    organizers: Organizer[]
    // Last-seen version for optimistic concurrency.
    updatedAt: Date | string
  }
}

/**
 * Details-only event form for organisers (OSS-41). Carries the same fields as
 * the public-details section of `EventForm` and nothing else — no slug, money,
 * publish, registration or ticket inputs — matching `updateManagedEvent`'s
 * server-side allowlist.
 *
 * @param props - Bound server action, stored event kind and current values.
 * @returns The form element.
 */
export function ManagedEventForm({ action, kind, defaultValues }: Readonly<Props>) {
  const [state, formAction, isPending] = useActionState(action, undefined)
  const recurring = kind === "recurring"
  const updatedAtIso =
    typeof defaultValues.updatedAt === "string" ? defaultValues.updatedAt : defaultValues.updatedAt.toISOString()
  // Force the preview <img> to reload after a replace (same trick as EventForm).
  const cacheBust = `?v=${Date.parse(updatedAtIso)}`

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-8">
      <FormFeedback state={state} />
      <input type="hidden" name="updatedAt" value={updatedAtIso} />

      <section>
        <h2 className="mb-4 border-b border-border pb-2 text-base font-semibold text-foreground">Event details</h2>
        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" name="title" defaultValue={defaultValues.title} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" defaultValue={defaultValues.description} rows={4} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="category">Category</Label>
            <Select name="category" defaultValue={defaultValues.category || "worship"}>
              <SelectTrigger id="category" className="w-full capitalize"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {recurring ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="recurs">Repeats *</Label>
                <Select name="recurs" defaultValue={defaultValues.recurs || "every-sunday"}>
                  <SelectTrigger id="recurs" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RECURS_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="recursLabel">Short label</Label>
                <Input id="recursLabel" name="recursLabel" defaultValue={defaultValues.recursLabel} placeholder="2nd Sun" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="startTime">Time</Label>
                <Input id="startTime" name="startTime" defaultValue={defaultValues.startTime} placeholder="9:30 AM" />
              </div>
              <div className="grid gap-1.5 md:col-span-3">
                <Label htmlFor="endDate">End date &amp; time</Label>
                <Input id="endDate" name="endDate" type="datetime-local" defaultValue={defaultValues.endDate} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="date">Date &amp; time *</Label>
                <Input id="date" name="date" type="datetime-local" defaultValue={defaultValues.date} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="endDate">End date &amp; time</Label>
                <Input id="endDate" name="endDate" type="datetime-local" defaultValue={defaultValues.endDate} />
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="location">Location</Label>
            <Input id="location" name="location" defaultValue={defaultValues.location} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="bannerFile">
              Banner image <span className="text-xs font-normal text-muted-foreground">(optional upload — wide ~1200×400, JPEG/PNG/WebP, max 2 MB)</span>
            </Label>
            {defaultValues.hasBanner && (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/events/${defaultValues.slug}/image/banner${cacheBust}`}
                  alt="Current banner"
                  className="h-16 w-28 rounded border border-border object-cover"
                />
                <label htmlFor="banner.remove" className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Checkbox id="banner.remove" name="banner.remove" value="true" />
                  Remove
                </label>
              </div>
            )}
            <Input id="bannerFile" name="bannerFile" type="file" accept="image/png,image/jpeg,image/webp" />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="posterFile">
              Poster image <span className="text-xs font-normal text-muted-foreground">(optional upload — portrait ~1080×1350, JPEG/PNG/WebP, max 2 MB)</span>
            </Label>
            {defaultValues.hasPoster && (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/events/${defaultValues.slug}/image/poster${cacheBust}`}
                  alt="Current poster"
                  className="h-24 w-16 rounded border border-border object-cover"
                />
                <label htmlFor="poster.remove" className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Checkbox id="poster.remove" name="poster.remove" value="true" />
                  Remove
                </label>
              </div>
            )}
            <Input id="posterFile" name="posterFile" type="file" accept="image/png,image/jpeg,image/webp" />
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-4 border-b border-border pb-2 text-base font-semibold text-foreground">
          Organisers <span className="text-xs font-normal text-muted-foreground">(optional — shown on the public event page)</span>
        </h2>
        <OrganizersEditor initial={defaultValues.organizers} />
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={isPending}>
          {isPending ? "Saving…" : "Save details"}
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/my-events">Cancel</Link>
        </Button>
      </div>
    </form>
  )
}
