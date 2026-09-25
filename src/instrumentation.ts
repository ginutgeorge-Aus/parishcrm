/**
 * Optional Application Insights telemetry ( observability, health, canary).
 *
 * Activates only when APPLICATIONINSIGHTS_CONNECTION_STRING is set. No-op
 * locally and in the Edge runtime — the monitor SDK is Node-only, so
 * middleware.ts (Edge) never loads it.
 *
 * Dynamic import keeps @azure/monitor-opentelemetry out of the Edge bundle and out
 * of any build that doesn't set the connection string.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // Fail-fast env validation: throwing here crashes the container at
  // boot, so the host keeps the previous revision serving instead of shipping a
  // silently broken deploy (2026-06-06 AUTH_SECRET login outage).
  const { assertRequiredEnv, collectEnvWarnings } = await import("@/lib/envCheck")
  assertRequiredEnv()

  // Non-fatal misconfiguration signals ( wrong receipt identity,
  // rate-limiter scaled past one replica) — log once at boot, never crash.
  for (const w of collectEnvWarnings()) {
    console.warn(JSON.stringify({ level: "warn", source: "env-check", message: w }))
  }

  // /: fail-fast on a weak ENCRYPTION_KEY (production) and warn about
  // retirable keys. Boot-only — never in the per-call decrypt path.
  const { assertKeyringHealthy } = await import("@/lib/crypto")
  assertKeyringHealthy()

  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  if (!connectionString) return

  const { useAzureMonitor } = await import("@azure/monitor-opentelemetry")
  const { UrlRedactingSpanProcessor } = await import("@/lib/telemetryRedact")
  // Not a React hook despite the use* name — the monitor SDK's bootstrap fn.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useAzureMonitor({
    azureMonitorExporterOptions: { connectionString },
    // Sample at 25% to stay inside the free 5 GB/mo ingestion tier under load.
    // Tune against observed volume (Portal → App Insights → Usage and estimated costs).
    samplingRatio: 0.25,
    // Strip query strings (e.g. /reset-password?token=…) before export — they
    // would otherwise leak single-use tokens into Reader-visible telemetry.
    spanProcessors: [new UrlRedactingSpanProcessor()],
  })
}

/**
 * Build the exception payload recorded on the active span. Returns only the
 * error type + message — never the stacktrace.
 *
 * `span.recordException(err)` would map an Error's `.stack` to the App Insights
 * `exceptions.stacktrace` column, readable by anyone with telemetry read access.
 * That is asymmetric with the console.error fallback below, which gates stacks
 * to development. Passing a plain object (no `stack` key) keeps the
 * exceptions table populated with type + message for prod debugging while the
 * stack stays out of Reader-visible telemetry. OpenTelemetry's `Exception`
 * type accepts `{ name?, message? }`, so no stacktrace attribute is emitted.
 */
export function spanExceptionFor(err: Error): { name: string; message: string } {
  return { name: err.name, message: err.message }
}

/**
 * Capture server-side errors (route handlers, server actions, RSC) as App Insights
 * exceptions. Next.js calls this for any error thrown on the server.
 *
 * NOTE: never attach PII or decrypted fields. Only route/digest context.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; renderSource: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // Persist every server error for the weekly error-issues cron,
  // independent of App Insights sampling/availability. Fire-and-forget.
  {
    const { captureError } = await import("@/lib/errorCapture")
    const { trace } = await import("@opentelemetry/api")
    const cid = trace.getActiveSpan()?.spanContext().traceId
    captureError({
      errorType: err instanceof Error ? err.name : "UnknownError",
      message: err instanceof Error ? err.message : String(err),
      route: context.routePath,
      method: request.method,
      correlationId: cid && !/^0+$/.test(cid) ? cid : null,
    })
  }

  if (!process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) return

  const { trace } = await import("@opentelemetry/api")
  const span = trace.getActiveSpan()
  // Only record on a RECORDING span. With samplingRatio=0.25 ~75% of requests
  // carry a sampled-out (non-recording) active span; recordException on it is a
  // no-op per the OTel spec, so the exception would reach neither App Insights
  // nor — because a span exists — the console fallback. Gate on isRecording()
  // so a sampled-out or absent span always falls through to console.error and
  // the error is at least in stdout.
  if (span?.isRecording() && err instanceof Error) {
    // Record type + message only — never the stack. See spanExceptionFor.
    span.recordException(spanExceptionFor(err))
    span.setAttribute("next.route", context.routePath)
    span.setAttribute("next.routerKind", context.routerKind)
    span.setAttribute("http.method", request.method)
  } else {
    // No recording span (no span, or sampled out) — surface to container logs as JSON.
    console.error(
      JSON.stringify({
        level: "error",
        route: context.routePath,
        method: request.method,
        message: err instanceof Error ? err.message : String(err),
        // Stack traces stay out of production stdout — container logs are readable
        // by anyone with Reader on the Container App / Log Analytics.
        // Positive check: an unset NODE_ENV must NOT leak stacks.
        stack: err instanceof Error && process.env.NODE_ENV === "development" ? err.stack : undefined,
      }),
    )
  }
}
