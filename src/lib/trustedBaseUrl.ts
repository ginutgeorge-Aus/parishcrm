/**
 * Trusted app base URL from server config (never from a request header).
 * `AUTH_URL` first, then `APP_URL`. Shared by the fundraiser checkout action and
 * the reminder emails so both build links from the same origin.
 * @returns the configured base URL, or undefined when neither is set
 */
export function trustedBaseUrl(): string | undefined {
  return process.env.AUTH_URL ?? process.env.APP_URL
}
