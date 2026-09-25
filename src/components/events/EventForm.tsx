"use client"

import { useActionState, useState, useRef } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { OrganizersEditor } from "./OrganizersEditor"
import type { Organizer } from "@/lib/eventOrganizers"
import { TicketTypesEditor } from "./TicketTypesEditor"
import type { Row as TicketRow, TicketTypeRow } from "./TicketTypesEditor"
import { CustomQuestionsEditor } from "./CustomQuestionsEditor"
import { TieredPricingEditor } from "./TieredPricingEditor"
import type { ActionResult } from "@/lib/actions/types"
import { CATEGORIES, RECURS_OPTIONS } from "@/lib/eventConstants"
import type { CustomQuestionType } from "@/lib/eventQuestions"

type QuestionRow = { id?: string; label: string; type: CustomQuestionType; required: boolean; options: string; body: string; ticketTypeNames: string; scope: "order" | "attendee"; allowOther: boolean }

type Props = {
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  defaultValues?: {
    title?: string
    slug?: string
    description?: string
    kind?: string
    category?: string
    date?: string
    endDate?: string
    registrationDeadline?: string
    recurs?: string
    recursLabel?: string
    startTime?: string
    location?: string
    bankBsb?: string
    bankAccount?: string
    onlinePaymentEnabled?: boolean
    passCardFee?: boolean
    familyWaiverEnabled?: boolean
    familyWaiverThreshold?: string
    tieredPricingEnabled?: boolean
    familyPricingTiers?: string[]
    imageUrl?: string
    reminderDaysBefore?: string
    hasBanner?: boolean
    hasPoster?: boolean
    ticketTypes?: TicketTypeRow[]
    customQuestions?: QuestionRow[]
    organizers?: Organizer[]
    // Last-seen version for optimistic concurrency. Serialized across
    // the RSC boundary as a Date or ISO string depending on Next's transport.
    updatedAt?: Date | string
  }
}

export function EventForm({ action, defaultValues = {} }: Props) {
  const [state, formAction, isPending] = useActionState(action, undefined)
  const [kind, setKind] = useState(defaultValues.kind === "recurring" ? "recurring" : "one_off")
  // Mirror the online-payment checkbox so the "pass card fee" toggle can disable
  // itself when card payment is off (surcharge is meaningless without it).
  const [onlinePaymentOn, setOnlinePaymentOn] = useState(!!defaultValues.onlinePaymentEnabled)
  // Surcharge flag is inert without online card payment. Track it so the checkbox
  // keeps the admin's intent across an online-payment off→on toggle in one edit,
  // instead of a disabled Radix checkbox silently dropping from FormData.
  const [passCardFeeOn, setPassCardFeeOn] = useState(!!defaultValues.passCardFee)
  // Family waiver and tiered pricing are mutually exclusive charging mechanisms —
  // mirror each other's on/off state so the UI can grey out the inactive one.
  const [waiverOn, setWaiverOn] = useState(!!defaultValues.familyWaiverEnabled)
  const [tieredOn, setTieredOn] = useState(!!defaultValues.tieredPricingEnabled)
  const recurring = kind === "recurring"

  const keySeq = useRef(0)
  const [ticketRows, setTicketRows] = useState<TicketRow[]>(
    () => (defaultValues.ticketTypes ?? []).map((r, i) => ({ ...r, countsTowardWaiver: r.countsTowardWaiver ?? "true", _key: `tt-init-${i}` }))
  )
  const addTicket = () => setTicketRows((r) => [...r, { name: "", price: "", capacity: "", countsTowardWaiver: "true", _key: `tt-new-${keySeq.current++}` }])
  const removeTicket = (i: number) => setTicketRows((r) => r.filter((_, idx) => idx !== i))
  const updateTicket = (i: number, field: keyof TicketTypeRow, value: string) =>
    setTicketRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)))

  const ticketNames = Array.from(
    new Set(ticketRows.map((r) => r.name.trim()).filter(Boolean))
  )

  // Force the preview <img> to reload after a replace — the src is otherwise
  // identical and the browser serves the stale cached image.
  const cacheBust =
    defaultValues.updatedAt
      ? `?v=${typeof defaultValues.updatedAt === "string" ? Date.parse(defaultValues.updatedAt) : defaultValues.updatedAt.getTime()}`
      : ""

  return (
    <form action={formAction} className="flex flex-col gap-8 max-w-2xl">
      <FormFeedback state={state} />

      {/* Optimistic-concurrency token — the row's last-seen version, so
          the server can reject a save that would clobber a concurrent edit. */}
      {defaultValues.updatedAt && (
        <input
          type="hidden"
          name="updatedAt"
          value={typeof defaultValues.updatedAt === "string" ? defaultValues.updatedAt : defaultValues.updatedAt.toISOString()}
        />
      )}

      {/* Section 1: Details */}
      <section>
        <h2 className="text-base font-semibold text-foreground mb-4 pb-2 border-b border-border uppercase">
          Event Details
        </h2>
        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" name="title" defaultValue={defaultValues.title} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="slug">
              Slug * <span className="text-xs text-muted-foreground font-normal">(used in public URL: /e/[slug])</span>
            </Label>
            <Input
              id="slug"
              name="slug"
              defaultValue={defaultValues.slug}
              required
              pattern="[a-z0-9\-]+"
              className="font-mono"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" defaultValue={defaultValues.description} rows={4} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="kind">Type *</Label>
              <Select name="kind" value={kind} onValueChange={setKind}>
                <SelectTrigger id="kind" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="one_off">One-off (specific date)</SelectItem>
                  <SelectItem value="recurring">Recurring (weekly/monthly)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="category">Category</Label>
              <Select name="category" defaultValue={defaultValues.category ?? "worship"}>
                <SelectTrigger id="category" className="w-full capitalize"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {recurring ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="recurs">Repeats *</Label>
                <Select name="recurs" defaultValue={defaultValues.recurs ?? "every-sunday"}>
                  <SelectTrigger id="recurs" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RECURS_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="recursLabel">
                  Short label <span className="text-xs text-muted-foreground font-normal">(calendar)</span>
                </Label>
                <Input id="recursLabel" name="recursLabel" defaultValue={defaultValues.recursLabel} placeholder="2nd Sun" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="startTime">Time</Label>
                <Input id="startTime" name="startTime" defaultValue={defaultValues.startTime} placeholder="9:30 AM" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="date">Date &amp; Time *</Label>
                <Input
                  id="date"
                  name="date"
                  type="datetime-local"
                  defaultValue={defaultValues.date}
                  required={!recurring}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="endDate">End Date &amp; Time</Label>
                <Input
                  id="endDate"
                  name="endDate"
                  type="datetime-local"
                  defaultValue={defaultValues.endDate}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="registrationDeadline">Registration Deadline</Label>
                <Input
                  id="registrationDeadline"
                  name="registrationDeadline"
                  type="datetime-local"
                  defaultValue={defaultValues.registrationDeadline}
                />
                <p className="text-xs text-muted-foreground">
                  Optional. Registration closes automatically after this time.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="reminderDaysBefore">Send reminder (days before)</Label>
                <Input
                  id="reminderDaysBefore"
                  name="reminderDaysBefore"
                  type="number"
                  min={1}
                  max={90}
                  defaultValue={defaultValues.reminderDaysBefore}
                  placeholder="e.g. 3 — leave blank for none"
                />
              </div>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="location">Location</Label>
            <Input id="location" name="location" defaultValue={defaultValues.location} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="imageUrl">
              Hero image URL <span className="text-xs text-muted-foreground font-normal">(optional, https only)</span>
            </Label>
            <Input
              id="imageUrl"
              name="imageUrl"
              type="url"
              defaultValue={defaultValues.imageUrl}
              placeholder="https://…"
            />
          </div>

          {/* Banner upload — replaces / supplements the pasted URL above.
              The pasted URL still works as a fallback when no file is uploaded. */}
          <div className="grid gap-1.5">
            <Label htmlFor="bannerFile">
              Banner image <span className="text-xs text-muted-foreground font-normal">(optional upload — wide ~1200×400, JPEG/PNG/WebP, max 2 MB)</span>
            </Label>
            {defaultValues.hasBanner && defaultValues.slug && (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/events/${defaultValues.slug}/image/banner${cacheBust}`}
                  alt="Current banner"
                  className="h-16 w-28 object-cover rounded border border-border"
                />
                <label htmlFor="banner.remove" className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Checkbox id="banner.remove" name="banner.remove" value="true" />
                  Remove
                </label>
              </div>
            )}
            <Input id="bannerFile" name="bannerFile" type="file" accept="image/png,image/jpeg,image/webp" />
          </div>

          {/* Poster upload — shown large on the public page's left column. */}
          <div className="grid gap-1.5">
            <Label htmlFor="posterFile">
              Poster image <span className="text-xs text-muted-foreground font-normal">(optional upload — portrait ~1080×1350, JPEG/PNG/WebP, max 2 MB)</span>
            </Label>
            {defaultValues.hasPoster && defaultValues.slug && (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/events/${defaultValues.slug}/image/poster${cacheBust}`}
                  alt="Current poster"
                  className="h-24 w-16 object-cover rounded border border-border"
                />
                <label htmlFor="poster.remove" className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Checkbox id="poster.remove" name="poster.remove" value="true" />
                  Remove
                </label>
              </div>
            )}
            <Input id="posterFile" name="posterFile" type="file" accept="image/png,image/jpeg,image/webp" />
          </div>
        </div>
      </section>

      {/* Section 2: Ticket Types */}
      <section>
        <h2 className="text-base font-semibold text-foreground mb-4 pb-2 border-b border-border uppercase">
          Ticket Types <span className="text-xs text-muted-foreground font-normal">(optional — add to enable registration)</span>
        </h2>
        <TicketTypesEditor rows={ticketRows} onAdd={addTicket} onRemove={removeTicket} onUpdate={updateTicket} />
      </section>

      {/* Section 3: Bank Details */}
      <section>
        <h2 className="text-base font-semibold text-foreground mb-4 pb-2 border-b border-border uppercase">
          Payment Details
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="bankBsb">BSB</Label>
            <Input id="bankBsb" name="bankBsb" defaultValue={defaultValues.bankBsb} placeholder="012-345" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bankAccount">Account Number</Label>
            <Input id="bankAccount" name="bankAccount" defaultValue={defaultValues.bankAccount} />
          </div>
        </div>
        <label htmlFor="onlinePaymentEnabled" className="mt-4 flex items-center gap-2 text-sm">
          <Checkbox
            id="onlinePaymentEnabled"
            name="onlinePaymentEnabled"
            defaultChecked={defaultValues.onlinePaymentEnabled}
            onCheckedChange={(c: boolean | "indeterminate") => setOnlinePaymentOn(c === true)}
          />
          Enable online card payment (Stripe)
          <span className="text-xs text-muted-foreground">— requires ticket prices &gt; 0 and Stripe configured</span>
        </label>
        <label htmlFor="passCardFee" className="mt-4 flex items-center gap-2 text-sm">
          <Checkbox
            id="passCardFee"
            name="passCardFee"
            checked={passCardFeeOn && onlinePaymentOn}
            onCheckedChange={(c: boolean | "indeterminate") => setPassCardFeeOn(c === true)}
            disabled={!onlinePaymentOn}
          />
          Pass card processing fee to registrant
          <span className="text-xs text-muted-foreground">— adds the Stripe fee to the card total so the church nets the ticket price</span>
        </label>
        <label htmlFor="familyWaiverEnabled" className="mt-4 flex items-center gap-2 text-sm">
          <Checkbox
            id="familyWaiverEnabled"
            name="familyWaiverEnabled"
            checked={waiverOn}
            onCheckedChange={(c: boolean | "indeterminate") => setWaiverOn(c === true)}
            // Disabled only while the OTHER flag is on and this one is off — if a
            // row somehow has both true (legacy data, direct DB edit), this stays
            // enabled so it can be unchecked instead of deadlocking both boxes
            // disabled with no in-app recovery.
            disabled={tieredOn && !waiverOn}
          />
          Enable family fee waiver
          <span className="text-xs text-muted-foreground">— extra attendees free once a family exceeds the threshold</span>
        </label>
        <div className="mt-2 grid gap-1.5 max-w-xs">
          <Label htmlFor="familyWaiverThreshold">
            Waiver threshold <span className="text-xs text-muted-foreground font-normal">(members who pay before the rest are free)</span>
          </Label>
          <Input
            id="familyWaiverThreshold"
            name="familyWaiverThreshold"
            type="number"
            min={0}
            max={1000}
            defaultValue={defaultValues.familyWaiverThreshold ?? "4"}
            placeholder="4"
            disabled={!waiverOn || tieredOn}
          />
        </div>
        <label htmlFor="tieredPricingEnabled" className="mt-4 flex items-center gap-2 text-sm">
          <Checkbox
            id="tieredPricingEnabled"
            name="tieredPricingEnabled"
            checked={tieredOn}
            onCheckedChange={(c: boolean | "indeterminate") => setTieredOn(c === true)}
            // Same rule as the waiver checkbox above: only disabled while
            // the other flag is on and this one is off.
            disabled={waiverOn && !tieredOn}
          />
          Tiered family pricing (whole-registration price by attendee count)
        </label>
        {/* Kept mounted (hidden when off) so toggling tiered pricing off then on
            preserves in-progress tier rows instead of remounting to defaults
. Server ignores tier fields unless tieredPricingEnabled. */}
        <div className={tieredOn ? "" : "hidden"}>
          <TieredPricingEditor defaultTiers={defaultValues.familyPricingTiers ?? []} active={tieredOn} />
        </div>
      </section>

      {/* Section 4: Custom Questions */}
      <section>
        <h2 className="text-base font-semibold text-foreground mb-4 pb-2 border-b border-border uppercase">
          Custom Questions <span className="text-xs text-muted-foreground font-normal">(optional)</span>
        </h2>
        <CustomQuestionsEditor initial={defaultValues.customQuestions ?? []} ticketTypeNames={ticketNames} />
      </section>

      {/* Section 5: Organisers */}
      <section>
        <h2 className="text-base font-semibold text-foreground mb-4 pb-2 border-b border-border uppercase">
          Organisers <span className="text-xs text-muted-foreground font-normal">(optional — shown on the public event page)</span>
        </h2>
        <OrganizersEditor initial={defaultValues.organizers ?? []} />
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={isPending}>
          {isPending ? "Saving…" : "Save Event"}
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/events">Cancel</Link>
        </Button>
      </div>
    </form>
  )
}
