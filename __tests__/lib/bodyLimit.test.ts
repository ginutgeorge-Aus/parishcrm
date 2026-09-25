/** @jest-environment node */
import { exceedsBodyLimit, publicBodyTooLarge, MAX_PUBLIC_BODY_BYTES } from "@/lib/bodyLimit"

function reqWith(headers: Record<string, string>, method = "POST"): Request {
  return new Request("http://localhost/x", { method, headers })
}

const MAX = 100 * 1024

describe("exceedsBodyLimit", () => {
  it("allows a body under the cap", () => {
    expect(exceedsBodyLimit(reqWith({ "content-length": "1024" }), MAX)).toBe(false)
  })

  it("allows a body exactly at the cap", () => {
    expect(exceedsBodyLimit(reqWith({ "content-length": String(MAX) }), MAX)).toBe(false)
  })

  it("rejects a body over the cap", () => {
    expect(exceedsBodyLimit(reqWith({ "content-length": String(MAX + 1) }), MAX)).toBe(true)
  })

  it("rejects a missing Content-Length (chunked Transfer-Encoding bypass)", () => {
    expect(exceedsBodyLimit(reqWith({}), MAX)).toBe(true)
  })

  it("rejects an empty Content-Length", () => {
    expect(exceedsBodyLimit(reqWith({ "content-length": "" }), MAX)).toBe(true)
  })

  it("rejects a negative Content-Length", () => {
    expect(exceedsBodyLimit(reqWith({ "content-length": "-1" }), MAX)).toBe(true)
  })

  it("rejects a non-numeric Content-Length", () => {
    expect(exceedsBodyLimit(reqWith({ "content-length": "abc" }), MAX)).toBe(true)
  })
})

describe("publicBodyTooLarge", () => {
  const big = String(MAX_PUBLIC_BODY_BYTES + 1)
  const ok = String(256 * 1024) // largest legit public body (Stripe webhook cap)

  it("rejects an oversized POST to a public path", () => {
    expect(publicBodyTooLarge("POST", true, reqWith({ "content-length": big }))).toBe(true)
  })

  it("allows a normal-sized POST to a public path", () => {
    expect(publicBodyTooLarge("POST", true, reqWith({ "content-length": ok }))).toBe(false)
  })

  it("ignores non-public paths — the admin image upload keeps Next's 5mb cap", () => {
    expect(publicBodyTooLarge("POST", false, reqWith({ "content-length": big }))).toBe(false)
  })

  it("ignores non-POST requests regardless of size", () => {
    expect(publicBodyTooLarge("GET", true, reqWith({ "content-length": big }, "GET"))).toBe(false)
  })

  it("rejects a public POST with no Content-Length (chunked bypass)", () => {
    expect(publicBodyTooLarge("POST", true, reqWith({}))).toBe(true)
  })
})
