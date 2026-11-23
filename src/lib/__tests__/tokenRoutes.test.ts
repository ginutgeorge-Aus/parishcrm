/** @jest-environment node */
import * as csp from "@/lib/csp"
import { TOKEN_ROUTES } from "@/lib/tokenRoutes"
import { redactPagePath } from "@/lib/redactPagePath"
import { redactUrlAttributes } from "@/lib/telemetryRedact"

describe("token route redaction", () => {
  it("redacts the fundraiser pay token in span attributes", () => {
    const attrs: Record<string, unknown> = {
      "url.path": "/pay/fundraiser/abc",
      "http.target": "/pay/fundraiser/abc?x=1",
      "url.full": "https://app.example.org/pay/fundraiser/abc",
    }
    redactUrlAttributes(attrs)
    expect(attrs["url.path"]).toBe("/pay/fundraiser/[token]")
    expect(attrs["http.target"]).toBe("/pay/fundraiser/[token]")
    expect(attrs["url.full"]).toBe("https://app.example.org/pay/fundraiser/[token]")
  })

  // Parity: every PUBLIC_* token route in csp.ts must have a redaction entry,
  // so a new bearer-token route cannot ship without being redacted.
  const cspTokenPatterns = Object.entries(csp)
    .filter(([name, v]) => name.startsWith("PUBLIC_") && v instanceof RegExp)
    .map(([name, v]) => [name, v as RegExp] as const)

  it("finds the csp token patterns", () => {
    expect(cspTokenPatterns.length).toBeGreaterThanOrEqual(5)
  })

  it.each(cspTokenPatterns.map(([n, re]) => [n, re]))("%s has a redaction entry", (_name, re) => {
    const route = TOKEN_ROUTES.find((r) => (re as RegExp).test(r.sample))
    expect(route).toBeDefined()
    expect(redactPagePath(route!.sample)).toContain("[token]")
    const attrs: Record<string, unknown> = { "url.path": route!.sample }
    redactUrlAttributes(attrs)
    expect(attrs["url.path"]).toContain("[token]")
  })
})
