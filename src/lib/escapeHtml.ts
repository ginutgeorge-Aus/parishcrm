/**
 * Escape text for safe interpolation into HTML (element content and quoted attribute values).
 * The single shared implementation: do not add local copies.
 * @param value raw text
 * @returns the text with `& < > " '` replaced by entities
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
