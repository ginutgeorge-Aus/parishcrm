/** @jest-environment node */
import { auditIpFromHeaders, clientIpFromHeaders, clientIpHeaderStatus, getClientIp } from "@/lib/clientIp"

const h = (xff?: string) => new Headers(xff === undefined ? {} : { "x-forwarded-for": xff })

describe("auditIpFromHeaders", () => {
  it("takes the rightmost proxy-appended entry", () => {
    expect(auditIpFromHeaders(h("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9")
  })
  it("accepts IPv6", () => {
    expect(auditIpFromHeaders(h("2001:db8::1"))).toBe("2001:db8::1")
    expect(auditIpFromHeaders(h("::ffff:192.0.2.128"))).toBe("192.0.2.128")
  })
  it("drops malformed values", () => {
    expect(auditIpFromHeaders(h("1.2.3.4, not-an-ip"))).toBeUndefined()
    expect(auditIpFromHeaders(h("1.2.3.4, "))).toBe("1.2.3.4")
    expect(auditIpFromHeaders(h(","))).toBeUndefined()
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

describe("clientIpFromHeaders", () => {
  it("takes the rightmost x-forwarded-for entry", () => {
    expect(clientIpFromHeaders(h("1.1.1.1, 2.2.2.2"))).toBe("2.2.2.2")
  })
  it("falls back to unknown when absent or empty", () => {
    expect(clientIpFromHeaders(h())).toBe("unknown")
    expect(clientIpFromHeaders(h(","))).toBe("unknown")
  })
  it("skips empty entries (trailing comma)", () => {
    expect(clientIpFromHeaders(h("1.2.3.4,"))).toBe("1.2.3.4")
    expect(auditIpFromHeaders(h("1.2.3.4,"))).toBe("1.2.3.4")
  })
})

describe("CLIENT_IP_HEADER", () => {
  const saved = process.env.CLIENT_IP_HEADER
  afterEach(() => {
    if (saved === undefined) delete process.env.CLIENT_IP_HEADER
    else process.env.CLIENT_IP_HEADER = saved
  })
  const hh = (o: Record<string, string>) => new Headers(o)

  it("unset: ignores the header and keeps rightmost-XFF behaviour", () => {
    delete process.env.CLIENT_IP_HEADER
    const headers = hh({ "x-forwarded-for": "6.6.6.6, 10.0.0.1", "cf-connecting-ip": "203.0.113.7" })
    expect(clientIpFromHeaders(headers)).toBe("10.0.0.1")
    expect(auditIpFromHeaders(headers)).toBe("10.0.0.1")
  })
  it("blank env behaves as unset", () => {
    process.env.CLIENT_IP_HEADER = "   "
    expect(clientIpFromHeaders(hh({ "x-forwarded-for": "10.0.0.1", "cf-connecting-ip": "203.0.113.7" }))).toBe("10.0.0.1")
  })
  it("set + valid IP header wins over XFF", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    const headers = hh({ "x-forwarded-for": "6.6.6.6, 10.0.0.1", "cf-connecting-ip": " 203.0.113.7 " })
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.7")
    expect(auditIpFromHeaders(headers)).toBe("203.0.113.7")
    expect(getClientIp(new Request("http://x", { headers: headers }))).toBe("203.0.113.7")
  })
  it("takes the rightmost entry of a comma-separated value (client-sent entries come first)", () => {
    process.env.CLIENT_IP_HEADER = "true-client-ip"
    expect(clientIpFromHeaders(hh({ "true-client-ip": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7")
  })
  it("set + missing header falls back to rightmost XFF", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    const headers = hh({ "x-forwarded-for": "6.6.6.6, 10.0.0.1" })
    expect(clientIpFromHeaders(headers)).toBe("10.0.0.1")
    expect(auditIpFromHeaders(headers)).toBe("10.0.0.1")
  })
  it("set + invalid header falls back to rightmost XFF", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    const headers = hh({ "x-forwarded-for": "6.6.6.6, 10.0.0.1", "cf-connecting-ip": "not-an-ip" })
    expect(clientIpFromHeaders(headers)).toBe("10.0.0.1")
    expect(auditIpFromHeaders(headers)).toBe("10.0.0.1")
  })
  it("set + nothing at all: unknown / undefined", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    expect(clientIpFromHeaders(hh({}))).toBe("unknown")
    expect(auditIpFromHeaders(hh({}))).toBeUndefined()
  })
  it("mixed-case env name matches the header", () => {
    process.env.CLIENT_IP_HEADER = " CF-Connecting-IP "
    expect(clientIpFromHeaders(hh({ "cf-connecting-ip": "203.0.113.7" }))).toBe("203.0.113.7")
  })
  it("accepts IPv6", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    expect(clientIpFromHeaders(hh({ "cf-connecting-ip": "2001:db8::1" }))).toBe("2001:db8::1")
    expect(auditIpFromHeaders(hh({ "cf-connecting-ip": "2001:db8::1" }))).toBe("2001:db8::1")
  })
})

describe("CLIENT_IP_HEADER — normalisation", () => {
  const saved = process.env.CLIENT_IP_HEADER
  beforeEach(() => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.CLIENT_IP_HEADER
    else process.env.CLIENT_IP_HEADER = saved
  })
  const cases: [string, string][] = [
    ["203.0.113.7:51234", "203.0.113.7"],
    ["[2001:db8::1]:443", "2001:db8::1"],
    ["[2001:db8::1]", "2001:db8::1"],
    ["2001:DB8::A", "2001:db8::a"],
    ["::ffff:1.2.3.4", "1.2.3.4"],
    ["::FFFF:1.2.3.4", "1.2.3.4"],
    ["6.6.6.6, 203.0.113.7,", "203.0.113.7"],
  ]
  it.each(cases)("%s -> %s", (input, expected) => {
    const headers = new Headers({ "cf-connecting-ip": input })
    expect(clientIpFromHeaders(headers)).toBe(expected)
    expect(auditIpFromHeaders(headers)).toBe(expected)
  })
  it("rejects a non-IP with a port-like suffix", () => {
    expect(auditIpFromHeaders(new Headers({ "cf-connecting-ip": "evil:80" }))).toBeUndefined()
  })
  it("audit XFF fallback is normalised too", () => {
    delete process.env.CLIENT_IP_HEADER
    expect(auditIpFromHeaders(h("::ffff:1.2.3.4"))).toBe("1.2.3.4")
  })
})

describe("CLIENT_IP_HEADER — missing header warning", () => {
  const saved = process.env.CLIENT_IP_HEADER
  afterEach(() => {
    jest.restoreAllMocks()
    if (saved === undefined) delete process.env.CLIENT_IP_HEADER
    else process.env.CLIENT_IP_HEADER = saved
  })
  it("falls back to XFF and warns once per process, without the value", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    jest.isolateModules(() => {
      const mod = require("@/lib/clientIp") as typeof import("@/lib/clientIp")
      const headers = new Headers({ "x-forwarded-for": "10.0.0.1", "cf-connecting-ip": "garbage-value" })
      expect(mod.clientIpFromHeaders(headers)).toBe("10.0.0.1")
      expect(mod.clientIpFromHeaders(new Headers({ "x-forwarded-for": "10.0.0.2" }))).toBe("10.0.0.2")
    })
    expect(warn).toHaveBeenCalledTimes(1)
    const msg = String(warn.mock.calls[0][0])
    expect(msg).toContain("cf-connecting-ip")
    expect(msg).toContain("x-forwarded-for")
    expect(msg).not.toContain("garbage-value")
  })
})

describe("CLIENT_IP_HEADER — ignored names", () => {
  const saved = process.env.CLIENT_IP_HEADER
  afterEach(() => {
    if (saved === undefined) delete process.env.CLIENT_IP_HEADER
    else process.env.CLIENT_IP_HEADER = saved
  })
  const headers = () => new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1", "cf-connecting-ip": "203.0.113.7" })

  it("an illegal header name does not throw and falls back to rightmost XFF", () => {
    process.env.CLIENT_IP_HEADER = "CF Connecting IP"
    expect(() => clientIpFromHeaders(headers())).not.toThrow()
    expect(clientIpFromHeaders(headers())).toBe("10.0.0.1")
    expect(auditIpFromHeaders(headers())).toBe("10.0.0.1")
  })
  it("x-forwarded-for / forwarded are never honoured (leftmost entry is spoofable)", () => {
    for (const name of ["x-forwarded-for", "X-Forwarded-For", "forwarded"]) {
      process.env.CLIENT_IP_HEADER = name
      expect(clientIpFromHeaders(headers())).toBe("10.0.0.1")
      expect(auditIpFromHeaders(headers())).toBe("10.0.0.1")
    }
  })
})

describe("clientIpHeaderStatus", () => {
  it("classifies env values", () => {
    expect(clientIpHeaderStatus(undefined)).toBe("unset")
    expect(clientIpHeaderStatus("  ")).toBe("unset")
    expect(clientIpHeaderStatus("cf connecting ip")).toBe("invalid")
    expect(clientIpHeaderStatus("cf-connecting-ip:")).toBe("invalid")
    expect(clientIpHeaderStatus(" X-Forwarded-For ")).toBe("spoofable")
    expect(clientIpHeaderStatus("forwarded")).toBe("spoofable")
    expect(clientIpHeaderStatus(" CF-Connecting-IP ")).toBe("ok")
    expect(clientIpHeaderStatus("true-client-ip")).toBe("ok")
  })
})
