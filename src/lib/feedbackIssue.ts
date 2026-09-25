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
export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`|[\]*_~<>#]/g, (c) => `\\${c}`)
}

// Technical context values each sit on one list line inside <details>; collapse
// CR/LF so a crafted value can't start forged metadata lines.
function escapeLine(value: string): string {
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
