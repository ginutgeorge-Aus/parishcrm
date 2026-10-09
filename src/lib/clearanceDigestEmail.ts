import type { ComplianceBuckets, BucketEntry } from "@/lib/clearanceCompliance"
import { COMPLIANCE_FILTERS, type ComplianceFilter } from "@/lib/clearanceComplianceView"
import { CLEARANCE_TYPE_LABELS, EXPIRING_WINDOW_DAYS } from "@/lib/clearanceStatus"

/** Names listed per bucket before "and N more" (keeps the email a sane size). */
export const NAMES_PER_BUCKET = 50

const HEADINGS: Record<ComplianceFilter, string> = {
  expired: "Expired",
  expiring: `Expiring within ${EXPIRING_WINDOW_DAYS} days`,
  missing: "Missing",
  unverified: "Unverified",
}

/** Escapes text for safe interpolation into HTML. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

/** "Name — WWCC, Safe Ministry". */
function entryLine(e: BucketEntry): string {
  return `${e.name} — ${e.types.map((t) => CLEARANCE_TYPE_LABELS[t]).join(", ")}`
}

/**
 * Renders the monthly clearance digest. Names, clearance types and counts
 * only: never a WWC number or date of birth (email is not an encrypted
 * channel). Empty buckets are omitted. `complianceUrl` null means the base URL
 * is not configured, so a plain navigation hint replaces the link.
 */
export function renderClearanceDigestEmail(input: {
  churchName: string
  asOf: string
  buckets: ComplianceBuckets
  complianceUrl: string | null
}): { subject: string; html: string; text: string } {
  const { churchName, asOf, buckets, complianceUrl } = input
  const subject = `Clearance compliance digest — ${churchName}`
  const reminder =
    "If the Working With Children Check authority (in NSW, the Office of the Children's Guardian) emails you a barring alert for a worker registered on your employer profile, act on it straight away. Do not wait for this digest."
  const footer = "This email lists names only: no WWCC numbers or dates of birth."

  const textParts: string[] = [`Clearance compliance as of ${asOf} — ${churchName}`, ""]
  const htmlParts: string[] = [
    `<p>Clearance compliance as of <strong>${esc(asOf)}</strong> — ${esc(churchName)}</p>`,
  ]

  for (const key of COMPLIANCE_FILTERS) {
    const entries = buckets[key]
    if (entries.length === 0) continue
    const shown = entries.slice(0, NAMES_PER_BUCKET)
    const more = entries.length - shown.length
    const heading = `${HEADINGS[key]} (${entries.length})`
    textParts.push(heading, ...shown.map((e) => `  - ${entryLine(e)}`))
    if (more > 0) textParts.push(`  ...and ${more} more`)
    textParts.push("")
    htmlParts.push(
      `<h3 style="font-family:Arial,sans-serif;margin:16px 0 4px">${esc(heading)}</h3>`,
      `<ul style="font-family:Arial,sans-serif;font-size:14px;margin:0;padding-left:20px">${shown
        .map((e) => `<li>${esc(entryLine(e))}</li>`)
        .join("")}${more > 0 ? `<li>...and ${more} more</li>` : ""}</ul>`
    )
  }

  if (complianceUrl) {
    textParts.push(`Review and verify: ${complianceUrl}`)
    htmlParts.push(`<p style="font-family:Arial,sans-serif;font-size:14px"><a href="${esc(complianceUrl)}">Open the clearance compliance page</a></p>`)
  } else {
    textParts.push("Review and verify: open People > Clearances in the CRM.")
    htmlParts.push(`<p style="font-family:Arial,sans-serif;font-size:14px">Review and verify: open People &gt; Clearances in the CRM.</p>`)
  }
  textParts.push("", reminder, "", footer)
  htmlParts.push(
    `<p style="font-family:Arial,sans-serif;font-size:14px"><strong>${esc(reminder)}</strong></p>`,
    `<p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8">${esc(footer)}</p>`
  )

  return { subject, html: htmlParts.join("\n"), text: textParts.join("\n") }
}
