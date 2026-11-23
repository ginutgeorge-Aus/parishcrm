// Single list of public routes whose path segment is a bearer token (see
// csp.ts isPublicPath). Anyone holding the token can use the page, so it must
// never reach telemetry, logs, GitHub issues or emails. Pure and client-safe
// (no Node imports): shared by redactPagePath.ts and telemetryRedact.ts.
// Add every new token route here; tokenRoutes.test.ts checks csp.ts parity.
export type TokenRoute = {
  /** Cheap substring pre-check before running the regex. */
  gate: string
  /** Regex source matching the route prefix up to and including the slash before the token. */
  prefix: string
  /** Example path, used by the csp.ts parity test. */
  sample: string
}

export const TOKEN_ROUTES: readonly TokenRoute[] = [
  { gate: "/venue/", prefix: "\\/venue\\/", sample: "/venue/abc" },
  { gate: "/family/update/", prefix: "\\/family\\/update\\/", sample: "/family/update/abc" },
  { gate: "/crew/", prefix: "\\/e\\/[^/?#]+\\/crew\\/", sample: "/e/slug/crew/abc" },
  { gate: "/api/roster/feed/", prefix: "\\/api\\/roster\\/feed\\/", sample: "/api/roster/feed/abc" },
  { gate: "/pay/fundraiser/", prefix: "\\/pay\\/fundraiser\\/", sample: "/pay/fundraiser/abc" },
]
