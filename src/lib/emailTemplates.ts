import type { FeatureKey } from "@/lib/features"
export const EMAIL_TEMPLATE_KEYS = ["welcome", "familyUpdate", "receipt", "dgrReceipt", "venueBookingRequest", "venueInvoiceRequest"] as const
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number]
export type EmailTemplateFields = { subject: string; intro: string; body: string; signoff: string }

// Templates owned by a feature: hidden in Settings while it's off. Unlisted = core.
const EMAIL_TEMPLATE_FEATURE: Partial<Record<EmailTemplateKey, FeatureKey>> = {
  familyUpdate: "familyUpdates",
  receipt: "receipts",
  dgrReceipt: "dgrReceipts",
}

/**
 * The feature owning a template, or undefined for a core template.
 * @param key template key (unvalidated input is fine: unknown keys are core)
 */
export function emailTemplateFeature(key: string): FeatureKey | undefined {
  return Object.hasOwn(EMAIL_TEMPLATE_FEATURE, key) ? EMAIL_TEMPLATE_FEATURE[key as EmailTemplateKey] : undefined
}

/** Keys of the venue-usage email templates (gated on the venue setting, not a FeatureKey). */
export type VenueEmailTemplateKey = "venueBookingRequest" | "venueInvoiceRequest"

/**
 * Whether a template key belongs to the venue usage feature.
 * @param key template key (unvalidated input is fine)
 */
export function isVenueTemplateKey(key: string): key is VenueEmailTemplateKey {
  return key === "venueBookingRequest" || key === "venueInvoiceRequest"
}

/**
 * Template keys to show in Settings: core ones always, feature-owned ones only
 * while their feature is on, venue ones only when venue usage is enabled.
 * @param enabled the enabled feature set
 * @param extra.venueUsage whether the venue usage setting is on
 */
export function visibleEmailTemplateKeys(
  enabled: ReadonlySet<FeatureKey>,
  extra: { venueUsage?: boolean } = {},
): EmailTemplateKey[] {
  return EMAIL_TEMPLATE_KEYS.filter((k) => {
    if (isVenueTemplateKey(k)) return !!extra.venueUsage
    const feature = EMAIL_TEMPLATE_FEATURE[k]
    return !feature || enabled.has(feature)
  })
}

export const EMAIL_TEMPLATE_LABELS: Record<EmailTemplateKey, string> = {
  welcome: "Welcome / set password",
  familyUpdate: "Family update invite",
  receipt: "Donation receipt",
  dgrReceipt: "Annual DGR receipt",
  venueBookingRequest: "Venue booking request",
  venueInvoiceRequest: "Venue invoice request",
}

const VENUE_VARS = ["{venueName}", "{contactName}", "{churchName}", "{month}", "{dates}", "{bookedDates}", "{totalHours}", "{senderName}"]

// Valid {vars} an admin may use, shown as insert-chips in the editor.
export const EMAIL_TEMPLATE_VARS: Record<EmailTemplateKey, string[]> = {
  welcome: ["{name}", "{role}", "{churchName}"],
  familyUpdate: ["{familyName}", "{churchName}"],
  receipt: ["{churchName}", "{transactionId}", "{date}"],
  dgrReceipt: ["{donorName}", "{receiptNo}", "{fyLabel}", "{churchName}"],
  venueBookingRequest: VENUE_VARS,
  venueInvoiceRequest: VENUE_VARS,
}

export const DEFAULT_EMAIL_TEMPLATES: Record<EmailTemplateKey, EmailTemplateFields> = {
  welcome: {
    subject: "Welcome to {churchName} — set your password",
    intro: "Hello {name},",
    body:
      "An account has been created for you ({role}). To get started, set your password using the secure link below. This link expires in 7 days.",
    signoff:
      "Log in securely, manage member families and people, report a bug or request a feature with the in-app Feedback button, and view events and (depending on your role) accounting.",
  },
  familyUpdate: {
    subject: "Update your family details — {churchName}",
    intro: "Hello {familyName},",
    body:
      "Our church records team has asked you to review and update your family's details. Click the button below to open your secure form. This link expires in 14 days.",
    signoff: "If you weren't expecting this, you can ignore this email.",
  },
  receipt: {
    subject: "Donation Receipt #{transactionId} — {date}",
    intro: "",
    body: "",
    signoff: "This is an official receipt. Please retain for your records.",
  },
  dgrReceipt: {
    subject: "Annual Donation Receipt {receiptNo} — FY {fyLabel}",
    intro: "Dear {donorName},",
    body: "Please find attached your annual tax-deductible donation receipt ({receiptNo}) for the {fyLabel} financial year.",
    signoff: "Please retain this receipt for your tax records. Thank you for your generous support of {churchName}.",
  },
  venueBookingRequest: {
    subject: "Booking request: {month} ({churchName})",
    intro: "Dear {contactName},",
    body:
      "We would like to book {venueName} on the following dates:\n\n{dates}\n\nFor reference, these dates are already booked with you:\n\n{bookedDates}\n\nCould you please confirm the new dates? Thank you for your help.",
    signoff: "Kind regards,\n{senderName}\n{churchName}",
  },
  venueInvoiceRequest: {
    subject: "Invoice request: {month} venue usage ({churchName})",
    intro: "Dear {contactName},",
    body:
      "We hope you are well. Could you please send us an invoice for our use of {venueName} during {month}? The dates and times we used are listed below.\n\n{dates}\n\nTotal: {totalHours}\n\nPlease let us know if any of these details differ from your records. Thank you for your help.",
    signoff: "Kind regards,\n{senderName}\n{churchName}",
  },
}

// Pure token substitution. Replaces {key} with vars[key]; unknown tokens are
// left verbatim (visible to the reader) and the call never throws.
export function applyVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(vars, key) ? vars[key] : match,
  )
}
