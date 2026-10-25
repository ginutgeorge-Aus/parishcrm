import { escapeHtml, formatMonthLabel } from "@/lib/venueUsage"

/**
 * Absolute link to the venue bookings page for a month (base from AUTH_URL).
 * @param month "YYYY-MM"
 * @returns the URL, or null when AUTH_URL is not a valid URL
 */
export function venuePageUrl(month: string): string | null {
  try {
    const url = new URL("/venue-usage", process.env.AUTH_URL ?? "http://localhost:3000")
    url.searchParams.set("month", month)
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Reminder to staff that last month's invoice request was NOT sent automatically, and why.
 * @param input church name, the month, human problems and the page link (or null)
 */
export function buildReminderEmail(input: { churchName: string; month: string; problems: string[]; url: string | null }): { subject: string; text: string; html: string } {
  const label = formatMonthLabel(input.month)
  const subject = `Venue invoice request for ${label} needs attention`
  const intro = `The invoice request to the venue for ${label} was not sent automatically. Please check the bookings and send it from the Venue bookings page.`
  const text = [intro, "", ...input.problems.map((p) => `- ${p}`), ...(input.url ? ["", input.url] : []), "", input.churchName].join("\n")
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    `<ul>${input.problems.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`,
    ...(input.url ? [`<p><a href="${escapeHtml(input.url)}">Open Venue bookings</a></p>`] : []),
    `<p>${escapeHtml(input.churchName)}</p>`,
  ].join("\n")
  return { subject, text, html }
}

/**
 * Notice to staff that the invoice request went out automatically.
 * @param input church name, month, confirmed-date count and the total hours label (e.g. "12 hours")
 */
export function buildAutoSentEmail(input: { churchName: string; month: string; rowCount: number; totalHoursLabel: string }): { subject: string; text: string; html: string } {
  const label = formatMonthLabel(input.month)
  const subject = `Invoice request for ${label} sent`
  const body = `The invoice request for ${label} was sent to the venue automatically: ${input.rowCount} confirmed ${input.rowCount === 1 ? "date" : "dates"}, ${input.totalHoursLabel}.`
  return {
    subject,
    text: [body, "", input.churchName].join("\n"),
    html: `<p>${escapeHtml(body)}</p>\n<p>${escapeHtml(input.churchName)}</p>`,
  }
}
