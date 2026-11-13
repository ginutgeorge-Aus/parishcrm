// Pure roster calendar feed helper — no DB, no React. buildRosterIcs() turns a
// person's roster assignments into an RFC 5545 VCALENDAR string (#627, part of
// #306). Reuses icsDateUTC from ics.ts; escaping/folding live here because
// ics.ts keeps them private and the single-event builder never needed folding.

import { icsDateUTC } from "@/lib/ics"
import { PRODUCT_NAME } from "@/lib/settingsConstants"

/** One roster assignment as plain data (no Prisma types). */
export interface RosterAssignment {
  /** Stable assignment id; becomes the UID so re-imports update, not duplicate. */
  id: string
  title: string
  start: Date
  end: Date
  description?: string | null
  location?: string | null
}

/** Options for buildRosterIcs. */
export interface RosterIcsOptions {
  /** Calendar display name (X-WR-CALNAME). */
  calendarName?: string
  /** DTSTAMP value; injectable for deterministic tests. Defaults to now. */
  now?: Date
  /**
   * UID domain suffix. Must be a plain hostname ([A-Za-z0-9.-]); anything
   * else (e.g. containing CR/LF) is ignored. Defaults to "roster.parishcrm".
   */
  uidDomain?: string
}

const MAX_OCTETS = 75
const DEFAULT_UID_DOMAIN = "roster.parishcrm"
const HOSTNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/

/**
 * Escape a TEXT value per RFC 5545 §3.3.11 (backslash, semicolon, comma,
 * newline).
 * @param s raw text
 * @returns escaped text safe to place after a property colon
 */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, String.raw`\;`)
    .replace(/,/g, String.raw`\,`)
    .replace(/\r\n|\r|\n/g, String.raw`\n`)
}

/**
 * Fold one content line to at most 75 octets per physical line (RFC 5545
 * §3.1): break with CRLF + single space. Never splits a multibyte UTF-8
 * character. Continuation lines count the leading space.
 * @param line unfolded content line (no line terminator)
 * @returns folded line, physical lines joined by CRLF + space
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = []
  let current = ""
  let octets = 0
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8")
    // Continuation lines start with a space, which uses 1 of the 75 octets.
    const limit = parts.length === 0 ? MAX_OCTETS : MAX_OCTETS - 1
    if (octets + size > limit) {
      parts.push(current)
      current = ""
      octets = 0
    }
    current += ch
    octets += size
  }
  parts.push(current)
  return parts.join("\r\n ")
}

/**
 * Build a VCALENDAR with one VEVENT per assignment.
 * @param assignments roster assignments for one person (may be empty)
 * @param opts optional calendar name, DTSTAMP override, UID domain
 * @returns CRLF-terminated .ics text
 */
export function buildRosterIcs(
  assignments: readonly RosterAssignment[],
  opts: RosterIcsOptions = {},
): string {
  const stamp = icsDateUTC(opts.now ?? new Date())
  const domain =
    opts.uidDomain && HOSTNAME_RE.test(opts.uidDomain)
      ? opts.uidDomain
      : DEFAULT_UID_DOMAIN
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${PRODUCT_NAME}//Roster//EN`,
    "CALSCALE:GREGORIAN",
  ]
  if (opts.calendarName) {
    lines.push(`X-WR-CALNAME:${escapeIcsText(opts.calendarName)}`)
  }
  for (const a of assignments) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(a.id)}@${domain}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDateUTC(a.start)}`,
      `DTEND:${icsDateUTC(a.end)}`,
      `SUMMARY:${escapeIcsText(a.title)}`,
    )
    if (a.description) lines.push(`DESCRIPTION:${escapeIcsText(a.description)}`)
    if (a.location) lines.push(`LOCATION:${escapeIcsText(a.location)}`)
    lines.push("END:VEVENT")
  }
  lines.push("END:VCALENDAR")
  return lines.map(foldIcsLine).join("\r\n") + "\r\n"
}
