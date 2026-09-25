import { safeImageContentType } from "@/lib/imageContentType"

describe("safeImageContentType", () => {
  it.each(["image/png", "image/jpeg", "image/gif", "image/webp"])(
    "passes through safe raster type %s",
    (mime) => {
      expect(safeImageContentType(mime)).toBe(mime)
    }
  )

  it("downgrades image/svg+xml to octet-stream (stored XSS vector)", () => {
    expect(safeImageContentType("image/svg+xml")).toBe("application/octet-stream")
  })

  it("downgrades text/html to octet-stream", () => {
    expect(safeImageContentType("text/html")).toBe("application/octet-stream")
  })

  it("downgrades an unrecognized/empty type to octet-stream", () => {
    expect(safeImageContentType("")).toBe("application/octet-stream")
    expect(safeImageContentType("application/x-arbitrary")).toBe("application/octet-stream")
  })
})
