/**
 * Sliding idle window for a "remembered" session: 7 days without activity
 * ends it. Shared by the server check (jwtCallback) and the client idle timer
 * so an open tab doesn't log a remembered user out at the short window.
 */
export const REMEMBERED_IDLE_MINUTES = 7 * 24 * 60
