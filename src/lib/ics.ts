// Pure calendar helpers — no DB, no React. buildIcs() produces an RFC 5545
// VCALENDAR string; googleCalendarUrl() produces an add-to-calendar link.
// Both are used by the registration confirmation email and the success page.

import { PRODUCT_NAME } from "@/lib/settingsConstants"

// UTC basic form: YYYYMMDDTHHMMSSZ. Calendar clients read this as an absolute
// instant, so a registrant in any timezone sees the correct local time.
export function icsDateUTC(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
}

// RFC 5545 §3.3.11: backslash, semicolon, comma and newline are special in
// TEXT values and must be escaped.
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
}

export function buildIcs(opts: {
  uid: string
  title: string
  description?: string
  location?: string
  start: Date
  end: Date
  // RFC 5545 §3.8.7.2: DTSTAMP is when the calendar object was created (now),
  // not the event start. Outlook/iTIP use it to detect updates. Injectable for
  // deterministic tests.
  now?: Date
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${PRODUCT_NAME}//Event Registration//EN`,
    "BEGIN:VEVENT",
    `UID:${escapeText(opts.uid)}`,
    `DTSTAMP:${icsDateUTC(opts.now ?? new Date())}`,
    `DTSTART:${icsDateUTC(opts.start)}`,
    `DTEND:${icsDateUTC(opts.end)}`,
    `SUMMARY:${escapeText(opts.title)}`,
  ]
  if (opts.description) lines.push(`DESCRIPTION:${escapeText(opts.description)}`)
  if (opts.location) lines.push(`LOCATION:${escapeText(opts.location)}`)
  lines.push("END:VEVENT", "END:VCALENDAR")
  // RFC 5545 requires CRLF line breaks.
  return lines.join("\r\n") + "\r\n"
}

export function googleCalendarUrl(opts: {
  title: string
  details?: string
  location?: string
  start: Date
  end: Date
}): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${icsDateUTC(opts.start)}/${icsDateUTC(opts.end)}`,
  })
  if (opts.details) params.set("details", opts.details)
  if (opts.location) params.set("location", opts.location)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
