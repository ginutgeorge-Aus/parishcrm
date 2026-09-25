// Neutral bundled branding placeholders served when a slot has no DB row.
// Public OSS image ships these; an instance overrides them via admin upload.
const frame = (label: string, w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">` +
  `<rect width="${w}" height="${h}" rx="12" fill="#e2e8f0"/>` +
  `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ` +
  `font-family="system-ui,sans-serif" font-size="${Math.round(h / 6)}" fill="#64748b">${label}</text></svg>`

import type { BrandingSlot } from "@/lib/generated/prisma/enums"

export const PLACEHOLDER_SVG: Record<BrandingSlot, string> = {
  LOGO: frame("Logo", 512, 466),
  CREST: frame("Crest", 128, 145),
  CREST_HEADER: frame("Crest", 56, 64),
  ICON: frame("Icon", 512, 512),
  // Wide banner matching the letterhead aspect (~5.83) so the membership-form
  // preview shows a letterhead-shaped placeholder, not a square logo.
  LETTERHEAD: frame("Letterhead", 1400, 240),
}
