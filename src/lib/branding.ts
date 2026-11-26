import { prisma } from "@/lib/prisma"
import { PLACEHOLDER_SVG } from "@/lib/brandingPlaceholders"
import type { BrandingSlot } from "@/lib/generated/prisma/enums"

export const IMAGE_SLOT_BY_PARAM: Record<string, BrandingSlot> = {
  logo: "LOGO",
  crest: "CREST",
  "crest-header": "CREST_HEADER",
  icon: "ICON",
  letterhead: "LETTERHEAD",
}

/**
 * Resolve a public URL param to a branding slot. Own keys only, so inherited
 * names such as "constructor" or "__proto__" are not slots (AUD-5-39).
 * @param param the `[slot]` route segment
 */
export function lookupImageSlot(param: string): BrandingSlot | undefined {
  return Object.hasOwn(IMAGE_SLOT_BY_PARAM, param) ? IMAGE_SLOT_BY_PARAM[param] : undefined
}

const DEFAULT_LETTERHEAD_ASPECT = 5.8333

export async function getBrandingAsset(
  slot: BrandingSlot,
): Promise<{ bytes: Buffer; mimeType: string; etag: string; fromDb: boolean }> {
  const row = await prisma.brandingAsset.findUnique({ where: { slot } })
  if (row) {
    return {
      bytes: Buffer.from(row.bytes),
      mimeType: row.mimeType,
      etag: `"${slot}-${row.updatedAt.getTime()}"`,
      fromDb: true,
    }
  }
  const svg = PLACEHOLDER_SVG[slot]
  return { bytes: Buffer.from(svg), mimeType: "image/svg+xml", etag: `"${slot}-default"`, fromDb: false }
}

export async function getLetterheadAsset(): Promise<{ bytes: Buffer; aspect: number } | null> {
  const row = await prisma.brandingAsset.findUnique({ where: { slot: "LETTERHEAD" } })
  if (!row) return null
  const aspect = row.width && row.height ? row.width / row.height : DEFAULT_LETTERHEAD_ASPECT
  return { bytes: Buffer.from(row.bytes), aspect }
}
