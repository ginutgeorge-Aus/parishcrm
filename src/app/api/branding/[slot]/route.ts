import { NextResponse } from "next/server"
import { getBrandingAsset, IMAGE_SLOT_BY_PARAM } from "@/lib/branding"

export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot: param } = await params
  const slot = IMAGE_SLOT_BY_PARAM[param]
  if (!slot) return new NextResponse("Not found", { status: 404 })

  const { bytes, mimeType, etag, fromDb } = await getBrandingAsset(slot)
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } })
  }
  // Uploaded assets: short cache + revalidate (updatedAt changes the ETag on re-upload).
  // Placeholders: same headers — cheap to re-serve, keeps logic simple.
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      // Stop the browser MIME-sniffing an asset into an executable type.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300, must-revalidate",
      ETag: etag,
      "X-Branding-Source": fromDb ? "db" : "default",
    },
  })
}
