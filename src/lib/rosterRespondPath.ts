/**
 * Shape of a roster confirm token in the `/roster/respond/[token]` path
 * (base64url payload, dot, base64url signature; capped like the verifier's 512).
 * Pure and client-safe so csp.ts and the action can share it.
 */
export const ROSTER_RESPOND_TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
