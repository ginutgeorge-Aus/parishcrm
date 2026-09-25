import { qrPath } from "@/lib/qr"

describe("qrPath", () => {
  it("returns a positive size (incl. quiet zone) and a non-empty path", () => {
    const { size, path } = qrPath("REG-TEST01")
    expect(size).toBeGreaterThan(2)
    expect(path.length).toBeGreaterThan(0)
    expect(path.startsWith("M")).toBe(true)
  })

  it("encodes different inputs to different paths", () => {
    expect(qrPath("REG-AAAAAA").path).not.toEqual(qrPath("REG-BBBBBB").path)
  })

  it("rejects empty input", () => {
    expect(() => qrPath("")).toThrow()
  })
})
