import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { canEdit } from "@/lib/roleGuard"
import { safeImageContentType } from "@/lib/imageContentType"
import { rateLimit } from "@/lib/rateLimit"
import { getClientIp } from "@/lib/clientIp"

// Lowercase URL param → Prisma enum. Anything else 404s (no enumeration of kinds).
const KIND_MAP = { banner: "BANNER", poster: "POSTER" } as const

const notFound = () => new NextResponse("Not found", { status: 404 })

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ slug: string; kind: string }> },
) {
  // Unauthenticated (same public tier as register/waitlist) — throttle
  // before any DB work. Higher N than register/waitlist's 10/min since a
  // single page load can fan out to both banner + poster.
  const ip = getClientIp(req)
  if (!rateLimit(`event-image:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { slug, kind } = await props.params
  // Object.hasOwn (not `!mapped`) so inherited keys like "__proto__" /
  // "constructor" / "toString" 404 here instead of returning a prototype
  // member and falling through to a DB call with a non-enum `kind`.
  if (!slug || !Object.hasOwn(KIND_MAP, kind)) return notFound()
  const mapped = KIND_MAP[kind as keyof typeof KIND_MAP]

  const img = await prisma.eventImage.findFirst({
    where: { kind: mapped, event: { slug } },
    select: { data: true, mimeType: true, event: { select: { isPublished: true } } },
  })
  if (!img) return notFound()

  // Published images are public; draft images are visible only to editors so a
  // 200-vs-404 can't confirm a draft slug exists (same rule as the public page).
  if (!img.event.isPublished) {
    const session = await auth()
    if (!canEdit(session?.user?.role)) return notFound()
  }

  const body = Buffer.isBuffer(img.data) ? img.data : Buffer.from(img.data as Uint8Array)
  return new NextResponse(body, {
    status: 200,
    headers: {
      // gemini-nightly: allowlist to safe raster types rather than
      // trusting the stored mimeType verbatim, and force no-sniff — an
      // unsafe stored value (e.g. image/svg+xml, text/html) would otherwise
      // execute inline instead of downloading (stored XSS).
      "Content-Type": safeImageContentType(img.mimeType),
      "X-Content-Type-Options": "nosniff",
      // Public/published: cacheable briefly so a replaced image refreshes within
      // 5 min (callers also append ?v=<updatedAt>). Draft: keep it private.
      "Cache-Control": img.event.isPublished
        ? "public, max-age=300"
        : "private, no-store",
    },
  })
}
