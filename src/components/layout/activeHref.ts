/**
 * The nav href to highlight: the longest href that equals `pathname` or is a
 * "/"-bounded prefix of it, so nested pages such as "/settings/audit-log/123"
 * highlight their parent. "/" matches only the root. Shared by the sidebar and
 * the settings tabs so their highlighting can't disagree.
 * @param pathname current pathname
 * @param hrefs candidate hrefs
 * @returns the best match, or null when none matches
 */
export function activeHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null
  for (const h of hrefs) {
    const hit = h === "/" ? pathname === "/" : pathname === h || pathname.startsWith(`${h}/`)
    if (hit && (best === null || h.length > best.length)) best = h
  }
  return best
}
