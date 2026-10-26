"use client"

import { updateVenueUsageSettings } from "@/lib/actions/venueUsage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormFeedback } from "@/components/ui/FormFeedback"
import type { VenueUsageSettings } from "@/lib/venueUsageSettings"
import { useKeepFormValues } from "./useKeepFormValues"
import { useFormDirty } from "./unsavedChanges"
import { SettingsCard } from "./ui/SettingsCard"
import { SettingsRow } from "./ui/SettingsRow"

/**
 * Venue usage card: switch the feature on and set the venue contact the monthly
 * invoice request goes to. Saved together; ADMIN only (enforced by the action).
 * @param props the current saved settings
 */
export function VenueUsageSettingsForm({ settings }: Readonly<{ settings: VenueUsageSettings }>) {
  const [state, formAction, isPending, keep, keepChecked] = useKeepFormValues(updateVenueUsageSettings)
  const { ref } = useFormDirty(state)

  return (
    <form ref={ref} action={formAction} key={JSON.stringify(settings)}>
      <SettingsCard
        title="Venue bookings"
        description="For churches that hire a hall or church building. Plan bookings, ask the venue to book them, then email a monthly invoice request."
        footer={<Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save venue bookings"}</Button>}
      >
        <SettingsRow label="Enable venue bookings" htmlFor="venue-enabled" description="Adds a Venue bookings page to the sidebar for editors.">
          <input
            id="venue-enabled"
            name="enabled"
            type="checkbox"
            defaultChecked={keepChecked("enabled", settings.enabled)}
            className="size-5 accent-primary"
          />
        </SettingsRow>
        <SettingsRow label="Venue name" htmlFor="venue-name">
          <Input id="venue-name" name="venueName" defaultValue={keep("venueName", settings.venueName)} placeholder="Example Hall" className="md:w-80" maxLength={200} />
        </SettingsRow>
        <SettingsRow label="Contact name" htmlFor="venue-contact-name" description="Used in the greeting, e.g. Dear Pat.">
          {(descId) => (
            <Input id="venue-contact-name" aria-describedby={descId} name="contactName" defaultValue={keep("contactName", settings.contactName)} placeholder="Pat Example" className="md:w-80" maxLength={200} />
          )}
        </SettingsRow>
        <SettingsRow label="Contact email" htmlFor="venue-contact-email" description="Where the invoice request is sent. Required to enable.">
          {(descId) => (
            <Input id="venue-contact-email" aria-describedby={descId} name="contactEmail" type="email" defaultValue={keep("contactEmail", settings.contactEmail)} placeholder="venue@example.com" className="md:w-80" maxLength={254} />
          )}
        </SettingsRow>
        <SettingsRow
          label="Invoice request CCs (optional)"
          htmlFor="venue-cc-email"
          description="Addresses copied on the invoice request. Separate with commas, up to 10."
        >
          {(descId) => (
            <Input id="venue-cc-email" aria-describedby={descId} name="ccEmail" inputMode="email" autoComplete="off" defaultValue={keep("ccEmail", settings.ccEmail)} placeholder="treasurer@example.com, secretary@example.com" className="md:w-80" maxLength={1000} />
          )}
        </SettingsRow>
        <SettingsRow
          label="Booking request CCs (optional)"
          htmlFor="venue-booking-cc"
          description="Extra addresses copied on booking requests and cancellation notices. Separate with commas, up to 10. The reply-to address is always copied."
        >
          {(descId) => (
            <Input id="venue-booking-cc" aria-describedby={descId} name="bookingCcEmails" inputMode="email" autoComplete="off" defaultValue={keep("bookingCcEmails", settings.bookingCcEmails)} placeholder="secretary@example.com, treasurer@example.com" className="md:w-80" maxLength={1000} />
          )}
        </SettingsRow>
        <SettingsRow
          label="Reply-to email (optional)"
          htmlFor="venue-reply-to"
          description="Where the venue's reply (the invoice) goes. Leave blank to use the email of whoever sends the request. This address is also copied on the request."
        >
          {(descId) => (
            <Input id="venue-reply-to" aria-describedby={descId} name="replyToEmail" type="email" defaultValue={keep("replyToEmail", settings.replyToEmail)} placeholder="office@example.com" className="md:w-80" maxLength={254} />
          )}
        </SettingsRow>
        <FormFeedback state={state} />
      </SettingsCard>
    </form>
  )
}
