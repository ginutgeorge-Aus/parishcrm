/**
 * Filename-safe slug: lower-case ASCII letters and digits joined by single
 * hyphens, so a quote, slash, space or non-ASCII character in user data cannot
 * break a `Content-Disposition` header (AUD-2-11).
 * @param name untrusted text, e.g. a group name or account code
 * @param fallback returned when nothing usable remains
 * @returns slug of at most 40 characters, never empty
 */
export function filenameSlug(name: string, fallback = "file"): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || fallback
}
