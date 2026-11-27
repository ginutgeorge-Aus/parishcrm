// Shared GitHub-issue construction for the staff feedback action
// (src/lib/actions/feedback.ts) and the public feedback action
// (src/lib/actions/publicFeedback.ts). Pure — no auth/DB/next imports — so both
// server actions can import it and it is unit-testable in the node env.

export type IssueClientContext = {
  userAgent?: string
  language?: string
  viewport?: string
  screen?: string
  dpr?: number
}

// Neutralise markdown control characters before embedding user-controlled text
// into an issue body. `<` too: `\<` is a CommonMark literal, so
// user text can't open or close raw HTML such as the `</details>` wrapper below.
// A mention is an `@` not preceded by a word character or dot (so emails and
// `user@host` URLs are left intact) and followed by a handle character.
const MENTION = /(?<![\w.])@(?=[\w-])/g

// A mention gets a zero-width space after the `@` so GitHub does not ping that
// user from the church's token (AUD-2-05).
/**
 * Escape markdown control characters and defuse `@mentions` in user text.
 * @param value untrusted text bound for a GitHub issue body
 * @returns text safe to embed in the issue markdown
 */
export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`|[\]*_~<>#]/g, (c) => `\\${c}`).replace(MENTION, "@\u200b")
}

// Technical context values each sit on one list line inside <details>; collapse
// CR/LF so a crafted value can't start forged metadata lines.
/**
 * Escape a value for one issue line: CR/LF collapsed, then markdown-escaped.
 * @param value untrusted text
 * @returns one-line escaped text
 */
export function escapeLine(value: string): string {
  return escapeMarkdown(value.replace(/[\r\n]+/g, " "))
}

// Code-point-safe slice so a 70th-char surrogate pair (emoji) isn't split.
export function buildIssueTitle(prefix: string, summary: string): string {
  return `${prefix}: ${[...summary].slice(0, 70).join("")}`
}

type BodyInput = {
  lead: string[] // caller-escaped label lines
  reporter: string // caller-escaped
  type: string
  pageUrl?: string | null
  client?: IssueClientContext
  timestamp: string
}

export function buildIssueBody(input: BodyInput): string {
  const { lead, reporter, type, pageUrl, client, timestamp } = input
  return [
    ...lead,
    "",
    "<details><summary>Technical details</summary>",
    "",
    // reporter is caller-escaped; only collapse CR/LF (a staff display name is free text).
    `- Reporter: ${reporter.replace(/[\r\n]+/g, " ")}`,
    `- Type: ${type}`,
    `- Page: ${pageUrl ? escapeLine(pageUrl) : "unknown"}`,
    `- Browser: ${client?.userAgent ? escapeLine(client.userAgent) : "unknown"}`,
    `- Language: ${client?.language ? escapeLine(client.language) : "unknown"}`,
    `- Viewport: ${client?.viewport ? escapeLine(client.viewport) : "?"} · Screen: ${client?.screen ? escapeLine(client.screen) : "?"} · DPR: ${client?.dpr ?? "?"}`,
    `- Submitted: ${timestamp}`,
    "</details>",
  ].join("\n")
}
