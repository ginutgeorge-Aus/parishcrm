import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  sanitizeFilename,
  sniffContentType,
} from "@/lib/fileUpload"

describe("sniffContentType", () => {
  it("detects PDF", () => {
    expect(sniffContentType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf")
  })
  it("detects JPEG", () => {
    expect(sniffContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
  })
  it("detects PNG", () => {
    expect(sniffContentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png")
  })
  it("accepts a Node Buffer (Uint8Array subclass)", () => {
    expect(sniffContentType(Buffer.from("%PDF-1.7"))).toBe("application/pdf")
  })
  it("returns null for unknown, truncated or empty input", () => {
    expect(sniffContentType(new Uint8Array([1, 2, 3, 4]))).toBeNull()
    expect(sniffContentType(new Uint8Array([0xff, 0xd8]))).toBeNull()
    expect(sniffContentType(new Uint8Array([]))).toBeNull()
    expect(sniffContentType(Buffer.from("<svg"))).toBeNull()
  })
})

describe("sanitizeFilename", () => {
  it("strips path segments", () => {
    expect(sanitizeFilename("C:\\Users\\x\\wwcc.pdf")).toBe("wwcc.pdf")
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd")
  })
  it("trims and caps length at 255", () => {
    expect(sanitizeFilename("  a.pdf  ")).toBe("a.pdf")
    expect(sanitizeFilename("x".repeat(400))).toHaveLength(255)
  })
  it("falls back to 'attachment' for empty names", () => {
    expect(sanitizeFilename("")).toBe("attachment")
    expect(sanitizeFilename("dir/")).toBe("attachment")
  })
})

describe("limits", () => {
  it("is 4 MB and JPEG/PNG/PDF only", () => {
    expect(MAX_UPLOAD_BYTES).toBe(4 * 1024 * 1024)
    expect([...ALLOWED_UPLOAD_TYPES].sort()).toEqual(["application/pdf", "image/jpeg", "image/png"])
  })
})
