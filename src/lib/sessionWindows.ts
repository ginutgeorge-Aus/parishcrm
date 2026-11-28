/**
 * Sliding idle window for a "remembered" session: 7 days without activity
 * ends it. Shared by the server check (jwtCallback) and the client idle timer
 * so an open tab doesn't log a remembered user out at the short window.
 */
export const REMEMBERED_IDLE_MINUTES = 7 * 24 * 60

/**
 * Absolute cap on a "remembered" session, measured from sign-in. The 7-day idle window slides, so
 * without this a stolen cookie used weekly would never expire (AUD-1-08).
 */
export const REMEMBERED_MAX_DAYS = 30

/**
 * JWT cookie lifetime in seconds (7 days). Shared by auth.ts and the middleware's auth.config.ts so
 * the two NextAuth instances cannot re-issue cookies with different lifetimes (AUD-1-06).
 */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
