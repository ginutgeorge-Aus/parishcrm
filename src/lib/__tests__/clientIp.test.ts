/** @jest-environment node */
import { auditIpFromHeaders, getClientIp } from "@/lib/clientIp"

const h = (xff?: string) => new Headers(xff === undefined ? {} : { "x-forwarded-for": xff })

describe("auditIpFromHeaders", () => {
  it("takes the rightmost proxy-appended entry", () => {
    expect(auditIpFromHeaders(h("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9")
  })
  it("accepts IPv6", () => {
    expect(auditIpFromHeaders(h("2001:db8::1"))).toBe("2001:db8::1")
    expect(auditIpFromHeaders(h("::ffff:192.0.2.128"))).toBe("::ffff:192.0.2.128")
  })
  it("drops malformed values", () => {
    expect(auditIpFromHeaders(h("1.2.3.4, not-an-ip"))).toBeUndefined()
    expect(auditIpFromHeaders(h("1.2.3.4,"))).toBeUndefined()
    expect(auditIpFromHeaders(h("999.999.999.999"))).toBeUndefined()
    expect(auditIpFromHeaders(h(":"))).toBeUndefined()
    expect(auditIpFromHeaders(h("1::2::3"))).toBeUndefined()
  })
  it("returns undefined when absent", () => {
    expect(auditIpFromHeaders(h())).toBeUndefined()
    expect(auditIpFromHeaders(undefined)).toBeUndefined()
  })
})

describe("getClientIp", () => {
  it("keeps its rightmost/unknown behaviour", () => {
    expect(getClientIp(new Request("http://x", { headers: { "x-forwarded-for": "a, b" } }))).toBe("b")
    expect(getClientIp(new Request("http://x"))).toBe("unknown")
  })
})
