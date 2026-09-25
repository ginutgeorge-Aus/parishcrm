import { trace } from "@opentelemetry/api"
import { captureError } from "@/lib/errorCapture"

/**
 * Thin structured logger.
 *
 * Emits one JSON object per line to stdout/stderr — the same `{ level, message, … }`
 * shape already used ad-hoc in `instrumentation.ts` and `env-check` — so container
 * logs are greppable and App Insights ingests them as structured traces.
 *
 * The correlation id is the **active OpenTelemetry span's traceId**, which is
 * exactly the App Insights *operation Id*. A log line and the request it belongs
 * to therefore share one id — you can pivot from any log line to the full request
 * trace in App Insights, or `grep <id>` the container logs for one request's whole
 * trail. The OTel context manager (installed by `@azure/monitor-opentelemetry`)
 * propagates the active span across `await`s automatically, so no id threading is
 * needed at call sites.
 *
 * When no span is active — local dev without App Insights, the Edge runtime, or
 * boot before the SDK starts — the id is simply omitted; logging still works.
 *
 * PII: never pass decrypted fields or member PII in `message`/`fields`. Log ids
 * and non-sensitive context only (same rule as `onRequestError`). Prefer
 * `{ error: e instanceof Error ? e.message : String(e) }` over the raw error so a
 * stack never lands in Reader-visible logs.
 */
export type LogFields = Record<string, unknown>

type Level = "info" | "warn" | "error"

function correlationId(): string | undefined {
  const traceId = trace.getActiveSpan()?.spanContext().traceId
  // A never-sampled / invalid context reports the all-zero trace id — treat that
  // as "no correlation" rather than emitting a meaningless 000…0.
  if (!traceId || /^0+$/.test(traceId)) return undefined
  return traceId
}

function emit(level: Level, message: string, fields?: LogFields): void {
  const cid = correlationId()
  // Spread caller fields FIRST so the core metadata below always wins — a stray
  // `level`/`message`/`time`/`correlationId` key in `fields` must never clobber
  // the real values a log parser keys off.
  const line = JSON.stringify({
    ...fields,
    level,
    message,
    ...(cid ? { correlationId: cid } : {}),
    time: new Date().toISOString(),
  })
  // Route by severity so container/Log-Analytics severity filters work.
  if (level === "error") {
    console.error(line)
    // Persist for the weekly error-issues cron. fields may carry a
    // structured route/errorType; fall back sensibly. Fire-and-forget.
    // Safe for any Node importer of logger.ts — captureError itself guards
    // the runtime and dynamic-imports prisma, and middleware.ts (Edge) never
    // imports logger.
    captureError({
      errorType: typeof fields?.errorType === "string" ? fields.errorType : "LoggedError",
      message,
      route: typeof fields?.route === "string" ? fields.route : null,
      correlationId: cid ?? null,
    })
  } else if (level === "warn") console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
}
