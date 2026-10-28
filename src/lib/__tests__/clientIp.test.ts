/** @jest-environment node */
import { classifyClientIpHeader, clientIpFromHeaders, clientIpOrUndefined, getClientIp } from "@/lib/clientIp"
import { logger } from "@/lib/logger"

jest.mock("@/lib/logger", () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }))

// Every test starts with clean mock call history; the warn-once flag is module state, so the tests
// that assert on it load a fresh module via jest.isolateModules.
beforeEach(() => {
  jest.clearAllMocks()
})

const h = (xff?: string) => new Headers(xff === undefined ? {} : { "x-forwarded-for": xff })

describe("clientIpOrUndefined", () => {
  it("takes the rightmost proxy-appended entry", () => {
    expect(clientIpOrUndefined(h("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9")
  })
  it("accepts IPv6", () => {
    expect(clientIpOrUndefined(h("2001:db8::1"))).toBe("2001:db8::1")
    expect(clientIpOrUndefined(h("::ffff:192.0.2.128"))).toBe("192.0.2.128")
  })
  it("drops malformed values", () => {
    expect(clientIpOrUndefined(h("1.2.3.4, not-an-ip"))).toBeUndefined()
    expect(clientIpOrUndefined(h("1.2.3.4, "))).toBeUndefined()
    expect(clientIpOrUndefined(h(","))).toBeUndefined()
    expect(clientIpOrUndefined(h("999.999.999.999"))).toBeUndefined()
    expect(clientIpOrUndefined(h(":"))).toBeUndefined()
    expect(clientIpOrUndefined(h("1::2::3"))).toBeUndefined()
  })
  it("returns undefined when absent", () => {
    expect(clientIpOrUndefined(h())).toBeUndefined()
    expect(clientIpOrUndefined(undefined)).toBeUndefined()
  })
})

describe("getClientIp", () => {
  it("keeps its rightmost/unknown behaviour", () => {
    expect(getClientIp(new Request("http://x", { headers: { "x-forwarded-for": "a, 2.2.2.2" } }))).toBe("2.2.2.2")
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
  it("an empty trailing entry is untrusted (pass-through), not skipped", () => {
    expect(clientIpFromHeaders(h("6.6.6.6,"))).toBe("unknown")
    expect(clientIpFromHeaders(h("1.1.1.1,"))).toBe("unknown")
    expect(clientIpOrUndefined(h("6.6.6.6, "))).toBeUndefined()
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
    expect(clientIpOrUndefined(headers)).toBe("10.0.0.1")
  })
  it("blank env behaves as unset", () => {
    process.env.CLIENT_IP_HEADER = "   "
    expect(clientIpFromHeaders(hh({ "x-forwarded-for": "10.0.0.1", "cf-connecting-ip": "203.0.113.7" }))).toBe("10.0.0.1")
  })
  it("set + valid IP header wins over XFF", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    const headers = hh({ "x-forwarded-for": "6.6.6.6, 10.0.0.1", "cf-connecting-ip": " 203.0.113.7 " })
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.7")
    expect(clientIpOrUndefined(headers)).toBe("203.0.113.7")
    expect(getClientIp(new Request("http://x", { headers: headers }))).toBe("203.0.113.7")
  })
  it("takes the rightmost entry of a comma-separated value (client-sent entries come first)", () => {
    process.env.CLIENT_IP_HEADER = "true-client-ip"
    expect(clientIpFromHeaders(hh({ "x-forwarded-for": "10.0.0.1", "true-client-ip": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7")
  })
  it("set + missing header falls back to rightmost XFF", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    const headers = hh({ "x-forwarded-for": "6.6.6.6, 10.0.0.1" })
    expect(clientIpFromHeaders(headers)).toBe("10.0.0.1")
    expect(clientIpOrUndefined(headers)).toBe("10.0.0.1")
  })
  it("set + invalid header falls back to rightmost XFF", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    const headers = hh({ "x-forwarded-for": "6.6.6.6, 10.0.0.1", "cf-connecting-ip": "not-an-ip" })
    expect(clientIpFromHeaders(headers)).toBe("10.0.0.1")
    expect(clientIpOrUndefined(headers)).toBe("10.0.0.1")
  })
  it("set + nothing at all: unknown / undefined", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    expect(clientIpFromHeaders(hh({}))).toBe("unknown")
    expect(clientIpOrUndefined(hh({}))).toBeUndefined()
  })
  it("mixed-case env name matches the header", () => {
    process.env.CLIENT_IP_HEADER = " CF-Connecting-IP "
    expect(clientIpFromHeaders(hh({ "x-forwarded-for": "10.0.0.1", "cf-connecting-ip": "203.0.113.7" }))).toBe("203.0.113.7")
  })
  it("accepts IPv6", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    const headers = hh({ "x-forwarded-for": "10.0.0.1", "cf-connecting-ip": "2001:db8::1" })
    expect(clientIpFromHeaders(headers)).toBe("2001:db8::1")
    expect(clientIpOrUndefined(headers)).toBe("2001:db8::1")
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
    ["0:0:0:0:0:ffff:1.2.3.4", "1.2.3.4"],
    ["0000:0000:0000:0000:0000:FFFF:0102:0304", "1.2.3.4"],
    ["2001:0db8:0000:0000:0000:0000:0000:0001", "2001:db8::1"],
    ["2001:DB8:0:0:0:0:0:1", "2001:db8::1"],
    ["6.6.6.6, 203.0.113.7", "203.0.113.7"],
  ]
  it.each(cases)("%s -> %s", (input, expected) => {
    const headers = new Headers({ "x-forwarded-for": "10.0.0.1", "cf-connecting-ip": input })
    expect(clientIpFromHeaders(headers)).toBe(expected)
    expect(clientIpOrUndefined(headers)).toBe(expected)
  })
  it("rejects a non-IP with a port-like suffix (falls back to XFF)", () => {
    expect(clientIpOrUndefined(new Headers({ "x-forwarded-for": "10.0.0.1", "cf-connecting-ip": "evil:80" }))).toBe("10.0.0.1")
  })
  it("audit XFF fallback is normalised too", () => {
    delete process.env.CLIENT_IP_HEADER
    expect(clientIpOrUndefined(h("::ffff:1.2.3.4"))).toBe("1.2.3.4")
  })
})

describe("CLIENT_IP_HEADER — XFF required to honour the header", () => {
  const saved = process.env.CLIENT_IP_HEADER
  afterEach(() => {
    if (saved === undefined) delete process.env.CLIENT_IP_HEADER
    else process.env.CLIENT_IP_HEADER = saved
  })
  it("ignores a spoofed configured header when the request has no x-forwarded-for, and warns", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    const warn = logger.warn as jest.Mock
    jest.isolateModules(() => {
      const mod = require("@/lib/clientIp") as typeof import("@/lib/clientIp")
      const headers = new Headers({ "cf-connecting-ip": "6.6.6.6" })
      expect(mod.clientIpFromHeaders(headers)).toBe("unknown")
      expect(mod.clientIpOrUndefined(headers)).toBeUndefined()
      expect(mod.clientIpOrUndefined(headers)).toBeUndefined()
    })
    expect(warn).toHaveBeenCalledTimes(1)
    const msg = String(warn.mock.calls[0][0])
    expect(msg).toContain("cf-connecting-ip")
    expect(msg).not.toContain("6.6.6.6")
  })
  it("does not warn when neither header is present (health check)", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    jest.isolateModules(() => {
      const mod = require("@/lib/clientIp") as typeof import("@/lib/clientIp")
      expect(mod.clientIpFromHeaders(new Headers())).toBe("unknown")
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })
  it("honours the header when x-forwarded-for is present", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "10.0.0.1", "cf-connecting-ip": "203.0.113.7" }))).toBe("203.0.113.7")
  })
})

describe("CLIENT_IP_HEADER — rate-limited missing-header warning", () => {
  const saved = process.env.CLIENT_IP_HEADER
  afterEach(() => {
    jest.restoreAllMocks()
    if (saved === undefined) delete process.env.CLIENT_IP_HEADER
    else process.env.CLIENT_IP_HEADER = saved
  })
  it("warns at most once per 10 minutes, without the value, and again after the window", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    const warn = logger.warn as jest.Mock
    let now = 1_000_000
    jest.spyOn(Date, "now").mockImplementation(() => now)
    jest.isolateModules(() => {
      const mod = require("@/lib/clientIp") as typeof import("@/lib/clientIp")
      const headers = new Headers({ "x-forwarded-for": "10.0.0.1", "cf-connecting-ip": "garbage-value" })
      expect(mod.clientIpFromHeaders(headers)).toBe("10.0.0.1")
      expect(mod.clientIpFromHeaders(new Headers({ "x-forwarded-for": "10.0.0.2" }))).toBe("10.0.0.2")
      expect(warn).toHaveBeenCalledTimes(1)
      now += 9 * 60_000
      mod.clientIpFromHeaders(headers)
      expect(warn).toHaveBeenCalledTimes(1)
      now += 2 * 60_000
      mod.clientIpFromHeaders(headers)
      expect(warn).toHaveBeenCalledTimes(2)
    })
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
    expect(clientIpOrUndefined(headers())).toBe("10.0.0.1")
  })
  it("x-forwarded-for / forwarded are never honoured (leftmost entry is spoofable)", () => {
    for (const name of ["x-forwarded-for", "X-Forwarded-For", "forwarded", "x-forwarded", "forwarded-for", "x-forwarded-client-ip", "x-original-forwarded-for"]) {
      process.env.CLIENT_IP_HEADER = name
      expect(clientIpFromHeaders(headers())).toBe("10.0.0.1")
      expect(clientIpOrUndefined(headers())).toBe("10.0.0.1")
    }
  })
})

describe("XFF normalisation (default path)", () => {
  beforeEach(() => {
    delete process.env.CLIENT_IP_HEADER
  })
  it("normalises ip:port, bracketed and ::ffff: forms to one bucket key", () => {
    for (const v of ["1.2.3.4", "1.2.3.4:5678", "::ffff:1.2.3.4", "[::ffff:1.2.3.4]:99", "::ffff:102:304"]) {
      expect(clientIpFromHeaders(h(v))).toBe("1.2.3.4")
    }
  })
  it("keys on the raw trimmed rightmost XFF entry when it is not a well-formed IP", () => {
    expect(clientIpFromHeaders(h("garbage"))).toBe("garbage")
    expect(clientIpFromHeaders(h("1.1.1.1, evil:80 "))).toBe("evil:80")
    expect(clientIpOrUndefined(h("garbage"))).toBeUndefined()
  })
  it("a non-IP configured CLIENT_IP_HEADER value is never used as a key", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    const hh = new Headers({ "x-forwarded-for": "9.9.9.9", "cf-connecting-ip": "evil:80" })
    expect(clientIpFromHeaders(hh)).toBe("9.9.9.9")
    delete process.env.CLIENT_IP_HEADER
  })
  it("canonicalises equivalent IPv6 spellings to one key", () => {
    for (const v of ["2001:DB8:0:0:0:0:0:1", "2001:0db8::0001", "[2001:db8::1]:8080", "2001:db8::1%eth0"]) {
      expect(clientIpFromHeaders(h(v))).toBe("2001:db8::1")
    }
    expect(clientIpFromHeaders(h("0:0:0:0:0:ffff:1.2.3.4"))).toBe("1.2.3.4")
    expect(clientIpFromHeaders(h("0:0:0:0:0:ffff:102:304"))).toBe("1.2.3.4")
  })
  it("rejects a zone id on an IPv4 address", () => {
    expect(clientIpOrUndefined(h("1.2.3.4%junk"))).toBeUndefined()
    expect(clientIpOrUndefined(h("1.2.3.4%eth0"))).toBeUndefined()
  })
  it("strips an IPv6 zone id", () => {
    expect(clientIpFromHeaders(h("fe80::1%eth0"))).toBe("fe80::1")
    expect(clientIpOrUndefined(h("fe80::1%eth0"))).toBe("fe80::1")
  })
  it("unwraps hex IPv4-mapped IPv6 for the audit IP too", () => {
    expect(clientIpOrUndefined(h("::ffff:102:304"))).toBe("1.2.3.4")
  })
})

describe("clientIpOrUndefined", () => {
  beforeEach(() => {
    delete process.env.CLIENT_IP_HEADER
  })
  it("returns undefined when there is no IP and the value otherwise", () => {
    expect(clientIpOrUndefined(h())).toBeUndefined()
    expect(clientIpOrUndefined(h(","))).toBeUndefined()
    expect(clientIpOrUndefined(h("1.2.3.4"))).toBe("1.2.3.4")
  })
  it("non-IP values (unknown, evil:80) are rejected, never passed through", () => {
    expect(clientIpOrUndefined(h("unknown"))).toBeUndefined()
    expect(clientIpOrUndefined(h("evil:80"))).toBeUndefined()
    expect(clientIpOrUndefined(null)).toBeUndefined()
  })
})

describe("classifyClientIpHeader", () => {
  it("classifies env values", () => {
    expect(classifyClientIpHeader(undefined)).toEqual({ kind: "unset", name: "" })
    expect(classifyClientIpHeader("  ").kind).toBe("unset")
    expect(classifyClientIpHeader("cf connecting ip").kind).toBe("invalid")
    expect(classifyClientIpHeader("cf-connecting-ip:").kind).toBe("invalid")
    for (const n of [" X-Forwarded-For ", "forwarded", "x-forwarded", "forwarded-for", "x-forwarded-client-ip", "x-original-forwarded-for"]) {
      expect(classifyClientIpHeader(n).kind).toBe("spoofable")
    }
    expect(classifyClientIpHeader(" X-Real-IP ")).toEqual({ kind: "passthrough", name: "x-real-ip" })
    for (const n of ["cf-connecting-ip", " True-Client-IP ", "fly-client-ip", "x-azure-clientip", "x-azure-socketip", "fastly-client-ip", "x-envoy-external-address"]) {
      expect(classifyClientIpHeader(n).kind).toBe("cdn")
    }
    expect(classifyClientIpHeader("x-my-proxy-ip")).toEqual({ kind: "custom", name: "x-my-proxy-ip" })
  })
})

describe("CLIENT_IP_HEADER=cloudfront-viewer-address (ip:port)", () => {
  const saved = process.env.CLIENT_IP_HEADER
  beforeEach(() => {
    process.env.CLIENT_IP_HEADER = "cloudfront-viewer-address"
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.CLIENT_IP_HEADER
    else process.env.CLIENT_IP_HEADER = saved
  })
  const cases: [string, string][] = [
    ["203.0.113.7:5678", "203.0.113.7"],
    ["2600:1f18:abcd::1:46532", "2600:1f18:abcd::1"], // 5-digit port
    ["2600:1f18:abcd::1:4653", "2600:1f18:abcd::1"], // 4-digit port
    ["[2600:1f18:abcd::1]:46532", "2600:1f18:abcd::1"],
  ]
  it.each(cases)("%s -> %s", (input, expected) => {
    const headers = new Headers({ "x-forwarded-for": "10.0.0.1", "cloudfront-viewer-address": input })
    expect(clientIpFromHeaders(headers)).toBe(expected)
    expect(clientIpOrUndefined(headers)).toBe(expected)
  })
})

describe("CLIENT_IP_HEADER — warning throttle is per kind", () => {
  const saved = process.env.CLIENT_IP_HEADER
  afterEach(() => {
    jest.restoreAllMocks()
    if (saved === undefined) delete process.env.CLIENT_IP_HEADER
    else process.env.CLIENT_IP_HEADER = saved
  })
  it("a fallback warning does not suppress a direct-hit warning", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip"
    const warn = logger.warn as jest.Mock
    jest.spyOn(Date, "now").mockImplementation(() => 1_000_000)
    jest.isolateModules(() => {
      const mod = require("@/lib/clientIp") as typeof import("@/lib/clientIp")
      mod.clientIpFromHeaders(new Headers({ "x-forwarded-for": "10.0.0.1", "cf-connecting-ip": "garbage" }))
      mod.clientIpFromHeaders(new Headers({ "cf-connecting-ip": "6.6.6.6" }))
      expect(warn).toHaveBeenCalledTimes(2)
    })
  })
})
