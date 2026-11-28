/**
 * Shape of a roster confirm token in the `/roster/respond/[token]` path
 * (base64url payload, dot, base64url signature), capped at the verifier's 512
 * characters. Pure and client-safe: csp.ts builds its public-path regex from
 * `ROSTER_RESPOND_TOKEN_SOURCE` so the middleware gate and the action cannot drift.
 */
export const ROSTER_RESPOND_TOKEN_SOURCE = "(?=[A-Za-z0-9_.-]{3,512}$)[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+"
export const ROSTER_RESPOND_TOKEN_RE = new RegExp(`^${ROSTER_RESPOND_TOKEN_SOURCE}$`)
