/**
 * Tests whether needle appears in haystack at a word boundary on both sides.
 *
 * "Word boundary" here means the character immediately before the match and
 * the character immediately after the match must both be non-uppercase-alpha
 * (or absent, i.e. the match is at the very start / end of the string).
 *
 * Haystack is expected to already be upper-cased by the caller; needle is
 * upper-cased inside this function so callers can pass either case.
 */
export function wordBoundaryMatch(haystack: string, needle: string): boolean {
  const n = needle.toUpperCase()
  if (n === "") return false
  // Scan every occurrence, not just the first: a needle whose first occurrence
  // sits mid-word ("BENJON SMITH") may still appear at a real word boundary
  // later in the same description ("... JON SMITH"). Stopping at the first hit
  // would mis-report a false negative.
  for (let idx = haystack.indexOf(n); idx !== -1; idx = haystack.indexOf(n, idx + 1)) {
    const before = haystack[idx - 1]
    const after = haystack[idx + n.length]
    // \p{Lu} (Unicode uppercase) so accented letters like É/Ā count as part of a
    // word — /[A-Z]/ would treat them as separators and false-match.
    const leadOk = before === undefined || !/\p{Lu}/u.test(before)
    const trailOk = after === undefined || !/\p{Lu}/u.test(after)
    if (leadOk && trailOk) return true
  }
  return false
}
