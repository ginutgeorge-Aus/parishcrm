/** @jest-environment node */
import { redactUrlAttributes, UrlRedactingSpanProcessor } from "@/lib/telemetryRedact"

describe("redactUrlAttributes", () => {
  it("strips the query string from url.full while keeping the path", () => {
    const attrs: Record<string, unknown> = {
      "url.full": "https://crm.example.com/reset-password?token=fake-test-token",
    }
    redactUrlAttributes(attrs)
    expect(attrs["url.full"]).toBe("https://crm.example.com/reset-password")
  })

  it("strips the query from deprecated http.url and http.target", () => {
    const attrs: Record<string, unknown> = {
      "http.url": "https://crm.example.com/reset-password?token=secret",
      "http.target": "/reset-password?token=secret",
    }
    redactUrlAttributes(attrs)
    expect(attrs["http.url"]).toBe("https://crm.example.com/reset-password")
    expect(attrs["http.target"]).toBe("/reset-password")
  })

  it("redacts the standalone url.query attribute", () => {
    const attrs: Record<string, unknown> = { "url.query": "token=secret&foo=bar" }
    redactUrlAttributes(attrs)
    expect(attrs["url.query"]).toBe("REDACTED")
  })

  it("leaves query-less URLs untouched", () => {
    const attrs: Record<string, unknown> = {
      "url.full": "https://crm.example.com/people",
      "http.target": "/people",
    }
    redactUrlAttributes(attrs)
    expect(attrs["url.full"]).toBe("https://crm.example.com/people")
    expect(attrs["http.target"]).toBe("/people")
  })

  it("ignores non-string and absent attributes", () => {
    const attrs: Record<string, unknown> = { "url.full": 123, "http.method": "GET" }
    expect(() => redactUrlAttributes(attrs)).not.toThrow()
    expect(attrs["url.full"]).toBe(123)
    expect(attrs["http.method"]).toBe("GET")
  })

  it("never leaves a token substring anywhere in the redacted attributes", () => {
    const attrs: Record<string, unknown> = {
      "url.full": "https://crm.example.com/reset-password?token=LEAKME",
      "http.target": "/reset-password?token=LEAKME",
      "url.query": "token=LEAKME",
    }
    redactUrlAttributes(attrs)
    expect(JSON.stringify(attrs)).not.toContain("LEAKME")
  })
})

describe("redactUrlAttributes — path-segment tokens", () => {
  it("redacts the /family/update/<token> path segment in url.full", () => {
    const attrs: Record<string, unknown> = {
      "url.full": "https://crm.example.com/family/update/SECRETTOKEN",
    }
    redactUrlAttributes(attrs)
    expect(attrs["url.full"]).toBe("https://crm.example.com/family/update/[token]")
  })

  it("redacts the path token in deprecated http.url and http.target", () => {
    const attrs: Record<string, unknown> = {
      "http.url": "https://crm.example.com/family/update/SECRETTOKEN",
      "http.target": "/family/update/SECRETTOKEN",
    }
    redactUrlAttributes(attrs)
    expect(attrs["http.url"]).toBe("https://crm.example.com/family/update/[token]")
    expect(attrs["http.target"]).toBe("/family/update/[token]")
  })

  it("redacts the path token in the current-semconv url.path attribute", () => {
    const attrs: Record<string, unknown> = { "url.path": "/family/update/SECRETTOKEN" }
    redactUrlAttributes(attrs)
    expect(attrs["url.path"]).toBe("/family/update/[token]")
  })

  it("redacts both a path token and a query string on the same URL", () => {
    const attrs: Record<string, unknown> = {
      "url.full": "https://crm.example.com/family/update/SECRETTOKEN?foo=bar",
    }
    redactUrlAttributes(attrs)
    expect(attrs["url.full"]).toBe("https://crm.example.com/family/update/[token]")
  })

  it("never leaves the path token substring anywhere", () => {
    const attrs: Record<string, unknown> = {
      "url.full": "https://crm.example.com/family/update/LEAKME",
      "http.target": "/family/update/LEAKME",
      "url.path": "/family/update/LEAKME",
    }
    redactUrlAttributes(attrs)
    expect(JSON.stringify(attrs)).not.toContain("LEAKME")
  })

  it("leaves non-token paths untouched", () => {
    const attrs: Record<string, unknown> = {
      "url.full": "https://crm.example.com/families/42",
      "url.path": "/families/42",
    }
    redactUrlAttributes(attrs)
    expect(attrs["url.full"]).toBe("https://crm.example.com/families/42")
    expect(attrs["url.path"]).toBe("/families/42")
  })
})

describe("redactUrlAttributes — volunteer crew view token", () => {
  it("redacts the /e/<slug>/crew/<token> path segment in url.full", () => {
    const attrs: Record<string, unknown> = {
      "url.full": "https://crm.example.com/e/summer-fair/crew/abc123deadbeef",
    }
    redactUrlAttributes(attrs)
    expect(attrs["url.full"]).toBe("https://crm.example.com/e/summer-fair/crew/[token]")
  })

  it("redacts the crew token in deprecated http.url and http.target", () => {
    const attrs: Record<string, unknown> = {
      "http.url": "https://crm.example.com/e/summer-fair/crew/abc123deadbeef",
      "http.target": "/e/summer-fair/crew/abc123deadbeef",
    }
    redactUrlAttributes(attrs)
    expect(attrs["http.url"]).toBe("https://crm.example.com/e/summer-fair/crew/[token]")
    expect(attrs["http.target"]).toBe("/e/summer-fair/crew/[token]")
  })

  it("redacts the crew token in the current-semconv url.path attribute", () => {
    const attrs: Record<string, unknown> = { "url.path": "/e/summer-fair/crew/abc123deadbeef" }
    redactUrlAttributes(attrs)
    expect(attrs["url.path"]).toBe("/e/summer-fair/crew/[token]")
  })

  it("redacts both a crew token and a query string on the same URL", () => {
    const attrs: Record<string, unknown> = {
      "url.full": "https://crm.example.com/e/summer-fair/crew/abc123deadbeef?foo=bar",
    }
    redactUrlAttributes(attrs)
    expect(attrs["url.full"]).toBe("https://crm.example.com/e/summer-fair/crew/[token]")
  })

  it("never leaves the crew token substring anywhere", () => {
    const attrs: Record<string, unknown> = {
      "url.full": "https://crm.example.com/e/summer-fair/crew/LEAKME",
      "http.target": "/e/summer-fair/crew/LEAKME",
      "url.path": "/e/summer-fair/crew/LEAKME",
    }
    redactUrlAttributes(attrs)
    expect(JSON.stringify(attrs)).not.toContain("LEAKME")
  })

  it("redacts a crew token even when the slug itself contains slashes-adjacent characters", () => {
    const attrs: Record<string, unknown> = { "url.path": "/e/harvest-festival-2026/crew/9f8e7d6c5b4a" }
    redactUrlAttributes(attrs)
    expect(attrs["url.path"]).toBe("/e/harvest-festival-2026/crew/[token]")
  })

  it("leaves a bare event page path (no crew token) untouched", () => {
    const attrs: Record<string, unknown> = { "url.path": "/e/summer-fair" }
    redactUrlAttributes(attrs)
    expect(attrs["url.path"]).toBe("/e/summer-fair")
  })
})

describe("UrlRedactingSpanProcessor", () => {
  it("redacts attributes in onEnd", () => {
    const span = {
      attributes: { "url.full": "https://x/reset-password?token=t" },
    }
    new UrlRedactingSpanProcessor().onEnd(span as never)
    expect(span.attributes["url.full"]).toBe("https://x/reset-password")
  })

  it("onStart / forceFlush / shutdown are no-op safe", async () => {
    const p = new UrlRedactingSpanProcessor()
    expect(() => p.onStart()).not.toThrow()
    await expect(p.forceFlush()).resolves.toBeUndefined()
    await expect(p.shutdown()).resolves.toBeUndefined()
  })
})
