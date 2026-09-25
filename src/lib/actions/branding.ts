"use server"

import sharp from "sharp"
import { auth } from "@/auth"
import { isAdmin } from "@/lib/roleGuard"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { IMAGE_SLOT_BY_PARAM } from "@/lib/branding"
import type { ActionResultWithSuccess } from "./types"

// Raster only. SVG is deliberately excluded: an uploaded SVG is served verbatim
// from the same-origin /api/branding/[slot] route, and SVG can carry <script>, so
// direct navigation would execute it in the app origin (stored XSS — admin-gated,
// but defence-in-depth). Bundled neutral placeholders are still SVG, but those are
// trusted code, not user uploads. sharp validates every raster below.
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"])
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB
// Upper bound on stored image dimensions (px, longest side). Ample for logos,
// crests, icons, and letterhead banners while capping decoded/stored size.
const MAX_DIMENSION = 2048

// Every "use server" export is client-callable — gate BEFORE reading any
// input (slot/file), not after, so an unauthenticated/under-privileged caller
// never triggers a DB read or sharp decode.
export async function uploadBranding(param: string, formData: FormData): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Not authorised." }

  const slot = IMAGE_SLOT_BY_PARAM[param]
  if (!slot) return { error: "Unknown branding slot." }

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { error: "No file provided." }
  if (file.size > MAX_BYTES) return { error: "File too large (max 2 MB)." }
  if (!ALLOWED_MIME.has(file.type)) return { error: "Unsupported image type." }

  const input = Buffer.from(await file.arrayBuffer())

  // Transcode every upload to PNG. This normalises the stored asset so it works
  // everywhere it is consumed: PDFKit's doc.image() supports only PNG/JPEG (not
  // WebP), and it keeps the manifest's declared image/png icon type accurate.
  // sharp also validates the bytes are a real image (throws → "Could not read").
  // - .rotate() bakes in EXIF orientation, so a phone photo tagged sideways is
  //   stored upright instead of rendering rotated.
  // - .resize(inside, no-enlarge) caps stored dimensions to a 2048px box: it
  //   bounds the decoded/stored asset (the 2 MB limit is on compressed input
  //   bytes, which a highly-compressible image can far exceed once decoded) and
  //   keeps any single slot's aspect ratio within a sane envelope, without
  //   upscaling smaller uploads. Aspect ratio is preserved.
  let png: Buffer
  let width: number | null = null
  let height: number | null = null
  try {
    const out = await sharp(input)
      .rotate()
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true })
    png = out.data
    width = out.info.width
    height = out.info.height
  } catch {
    return { error: "Could not read image." }
  }

  const bytes = new Uint8Array(png)
  await prisma.brandingAsset.upsert({
    where: { slot },
    create: { slot, bytes, mimeType: "image/png", width, height },
    update: { bytes, mimeType: "image/png", width, height },
  })
  await logAudit(actorId(session), "BRANDING_UPLOAD", "BrandingAsset", undefined, { slot })
  revalidatePath("/settings")
  return { success: "Branding updated." }
}

export async function resetBranding(param: string): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Not authorised." }

  const slot = IMAGE_SLOT_BY_PARAM[param]
  if (!slot) return { error: "Unknown branding slot." }

  try {
    await prisma.brandingAsset.delete({ where: { slot } })
  } catch (e) {
    // Already at default (no row to delete) — idempotent no-op. Any other
    // error (DB outage, FK issue) must still surface, not be swallowed.
    if ((e as { code?: unknown })?.code !== "P2025") throw e
  }
  await logAudit(actorId(session), "BRANDING_RESET", "BrandingAsset", undefined, { slot })
  revalidatePath("/settings")
  return { success: "Reset to default." }
}
