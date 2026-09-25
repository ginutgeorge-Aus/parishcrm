// Shared CSV cell escaping for all export modules.
export function escapeCsv(val: string | number | null | undefined): string {
  const s = String(val ?? "")
  // Prefix formula-injection characters so spreadsheets don't execute them —
  // but leave a plain negative number (e.g. -100.00) numeric instead of turning
  // it into a text literal; a bare number can't start a formula.
  const isPlainNumber = /^-?\d+(\.\d+)?$/.test(s)
  // A "+"-prefixed value gets NO exception: Excel evaluates any leading "+", and
  // no regex distinguishes a phone (+61…) from arithmetic (+1-1 → 0), so every
  // "+"-leading value is neutralized. This supersedes the earlier phone-shaped
  // exemption, which let phone-shaped values be evaluated.
  // OWASP CSV-injection guidance also flags a leading Tab (0x09) or CR (0x0D):
  // a spreadsheet can trim leading whitespace before evaluating whether a cell
  // starts with a formula character, so "\t=cmd|..." is a bypass of the plain
  // "=+-@" check.
  const safe = !isPlainNumber && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  if (safe.includes(",") || safe.includes('"') || safe.includes("\n") || safe.includes("\r")) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}
