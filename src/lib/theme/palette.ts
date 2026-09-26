// Single source for server-rendered brand colours — PDFs (welcome letter, DGR
// receipt, membership), transactional emails, the OTP mail, print pages, and the
// PWA manifest / mobile theme-colour. Ships neutral monochrome-slate defaults so
// the open-source image is church-agnostic; a deploy restores its own look by
// setting the THEME_* env vars, with zero source edits (OSS migration Phase 2).
//
// CSS UI tokens live in globals.css (with a per-deploy override injected by the
// root layout from these same env vars) — this module is the non-CSS twin.

// Parse an operator-supplied THEME_* value to canonical lowercase #RRGGBB, or
// null if absent/malformed. The root layout uses null to decide whether to emit
// a :root override at all, so a typo can't inject a broken token (it falls back
// to the neutral globals.css defaults instead).
export function parseHex(value: string | undefined): string | null {
  if (!value) return null
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim())
  return m ? `#${m[1].toLowerCase()}` : null
}

// Normalize to canonical #RRGGBB with a neutral fallback. These hex exports are
// handed verbatim to PDFKit / inline email + manifest styles, which need a valid
// CSS colour — so "1e293b" (no #) or a typo would render the CSS token correctly
// yet break the PDF/email/manifest path. Env is trusted build config, so a
// malformed value falls back rather than throwing.
function normHex(value: string | undefined, fallback: string): string {
  return parseHex(value) ?? fallback
}

// Brand — env-overridable. Neutral slate defaults; an instance sets its own.
export const PRIMARY_HEX = normHex(process.env.THEME_PRIMARY, "#1e293b") // slate-800
// Deeper primary for section bands / reminder buttons; inherits PRIMARY when
// unset so a deploy that sets only THEME_PRIMARY still looks coherent.
export const PRIMARY_DARK_HEX = normHex(process.env.THEME_PRIMARY_DARK, PRIMARY_HEX)
// Emphasis / rule lines. Neutral slate-400 stays visible on white.
export const ACCENT_HEX = normHex(process.env.THEME_ACCENT, "#94a3b8") // slate-400

// Theme-independent neutrals + money semantics shared across the PDF/email
// renderers (previously duplicated as per-file consts). Not branded — no env.
export const SLATE_700 = "#334155"
export const SLATE_500 = "#64748b"
export const SLATE_400 = "#94a3b8"
export const BORDER = "#e2e8f0" // slate-200
export const BORDER_STRONG = "#cbd5e1" // slate-300
export const LIGHT_BG = "#f8fafc" // slate-50
export const GREEN = "#16a34a" // income / positive

// Convert #RRGGBB to the space-separated "H S% L%" triple shadcn tokens expect.
// Used by the root layout to inject a per-deploy :root override from THEME_* env.
// Malformed input falls back to the neutral primary triple rather than emitting
// "NaN% NaN%" into the stylesheet.
export function hexToHslTriple(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return "217 33% 17%"
  const n = Number.parseInt(m[1], 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case r:
        h = ((g - b) / d) % 6
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
    }
    h *= 60
    if (h < 0) h += 360
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}
