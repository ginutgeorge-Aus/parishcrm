/**
 * Strips sensitive tokens out of App Insights HTTP span telemetry.
 *
 * The auto-HTTP instrumentation records the full request target. Two leak paths:
 *  - Query strings — `/reset-password?token=<hex64>`. We drop every query
 *    string, since the token route is a normal page we can't allowlist.
 *  - Path segments — a valid single-use token carried as a path segment, so
 *    query-stripping alone misses it. We rewrite that segment to `[token]`.
 *    Covers `/family/update/<token>` and the volunteer view route
 *    `/e/<slug>/crew/<token>`.
 * Either would otherwise land a live token in telemetry readable by anyone with
 * telemetry read access.
 */
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base"

// URL-bearing attributes whose value is `…?<query>` (or a full URL with one).
// Covers both current (`url.full`) and deprecated (`http.url`/`http.target`)
// OpenTelemetry HTTP semantic conventions, since the emitted set varies by
// instrumentation version.
const URL_ATTRS_WITH_QUERY = ["url.full", "http.url", "http.target"]
// URL/path-bearing attributes that may contain a token *in the path* — includes
// the current-semconv `url.path` (query is broken out separately there).
const URL_ATTRS_WITH_PATH = ["url.full", "http.url", "http.target", "url.path"]
// The query string broken out as its own attribute (current semconv).
const QUERY_ATTR = "url.query"
// Path segments that carry a single-use token, one entry per route. `gate` is
// a cheap substring pre-check so the (possibly costlier) regex only runs when
// it might match; each `re`'s captured group 1 is the literal route prefix,
// with the following segment (the token) replaced. Add future token routes
// here — single list so nothing else needs touching.
const PATH_TOKEN_PATTERNS: { gate: string; re: RegExp }[] = [
  { gate: "/family/update/", re: /(\/family\/update\/)[^/?#]+/g },
  // Volunteer crew view: /e/<slug>/crew/<token>.
  { gate: "/crew/", re: /(\/e\/[^/?#]+\/crew\/)[^/?#]+/g },
]

function stripQueryStrings(attributes: Record<string, unknown>): void {
  for (const key of URL_ATTRS_WITH_QUERY) {
    const value = attributes[key]
    if (typeof value !== "string") continue
    const q = value.indexOf("?")
    if (q !== -1) attributes[key] = value.slice(0, q)
  }
}

function redactPathTokens(value: string): string {
  let next = value
  for (const { gate, re } of PATH_TOKEN_PATTERNS) {
    if (next.includes(gate)) next = next.replace(re, "$1[token]")
  }
  return next
}

function redactQueryAttr(attributes: Record<string, unknown>): void {
  if (typeof attributes[QUERY_ATTR] !== "string") return
  attributes[QUERY_ATTR] = "REDACTED"
  // Guard against a future OTel SDK sealing span attributes: if the
  // in-place mutation silently no-ops, a reset-password token would leak to
  // App Insights. Surface it loudly so the regression is caught immediately.
  if (attributes[QUERY_ATTR] !== "REDACTED") {
    console.error(
      "[telemetry-redact] URL query redaction failed — span attributes appear immutable; sensitive query strings may be exported",
    )
  }
}

/** Mutates `attributes` in place, removing any query string and path token. */
export function redactUrlAttributes(attributes: Record<string, unknown>): void {
  stripQueryStrings(attributes)
  for (const key of URL_ATTRS_WITH_PATH) {
    const value = attributes[key]
    if (typeof value === "string") attributes[key] = redactPathTokens(value)
  }
  redactQueryAttr(attributes)
}

/** SpanProcessor that redacts URL query strings on span end, before export. */
export class UrlRedactingSpanProcessor implements SpanProcessor {
  onStart(): void {}
  onEnd(span: ReadableSpan): void {
    // If a future OTel SDK freezes `ReadableSpan.attributes`, the in-place
    // assignment throws a TypeError in ESM strict mode *before* the inline guard
    // in redactUrlAttributes can report it. An unhandled throw here would break
    // the span-export pipeline, so catch and surface loudly instead.
    try {
      redactUrlAttributes(span.attributes as Record<string, unknown>)
    } catch {
      console.error(
        "[telemetry-redact] span attributes appear immutable; URL redaction skipped — sensitive query strings/path tokens may be exported",
      )
    }
  }
  async forceFlush(): Promise<void> {
    // no-op: redaction is synchronous; nothing buffered to flush
  }
  async shutdown(): Promise<void> {
    // no-op: holds no resources; the Azure Monitor exporter owns shutdown
  }
}
