import { getBrandingAsset, getLetterheadAsset, IMAGE_SLOT_BY_PARAM } from "@/lib/branding"

jest.mock("@/lib/prisma", () => ({ prisma: { brandingAsset: { findUnique: jest.fn() } } }))
import { prisma } from "@/lib/prisma"
const findUnique = prisma.brandingAsset.findUnique as jest.Mock

beforeEach(() => jest.clearAllMocks())

test("maps url params to slots", () => {
  expect(IMAGE_SLOT_BY_PARAM["crest-header"]).toBe("CREST_HEADER")
  expect(IMAGE_SLOT_BY_PARAM["logo"]).toBe("LOGO")
  expect(IMAGE_SLOT_BY_PARAM["nope"]).toBeUndefined()
})

test("returns DB bytes with mime + etag when row exists", async () => {
  findUnique.mockResolvedValue({ slot: "LOGO", bytes: Buffer.from("PNGDATA"), mimeType: "image/png", updatedAt: new Date("2026-01-01T00:00:00Z") })
  const a = await getBrandingAsset("LOGO")
  expect(a.fromDb).toBe(true)
  expect(a.mimeType).toBe("image/png")
  expect(a.bytes.toString()).toBe("PNGDATA")
  expect(a.etag).toBe(`"LOGO-${new Date("2026-01-01T00:00:00Z").getTime()}"`)
})

test("falls back to neutral svg placeholder when no row", async () => {
  findUnique.mockResolvedValue(null)
  const a = await getBrandingAsset("CREST")
  expect(a.fromDb).toBe(false)
  expect(a.mimeType).toBe("image/svg+xml")
  expect(a.bytes.toString()).toContain("Crest")
})

test("getLetterheadAsset returns null when no row", async () => {
  findUnique.mockResolvedValue(null)
  expect(await getLetterheadAsset()).toBeNull()
})

test("getLetterheadAsset derives aspect from width/height", async () => {
  findUnique.mockResolvedValue({ slot: "LETTERHEAD", bytes: Buffer.from("x"), mimeType: "image/png", width: 1400, height: 240, updatedAt: new Date() })
  const l = await getLetterheadAsset()
  expect(l?.aspect).toBeCloseTo(1400 / 240)
})
