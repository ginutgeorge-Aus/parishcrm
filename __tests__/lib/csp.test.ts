import { buildCsp, isPublicPath, SECURITY_HEADERS } from "@/lib/csp"

describe("buildCsp — img-src", () => {
  it("allows https images", () => {
    expect(buildCsp("n", false)).toContain("img-src 'self' data: blob: https:")
  })
})

describe("buildCsp", () => {
  it("puts a nonce and strict-dynamic in script-src, without unsafe-inline", () => {
    const csp = buildCsp("abc123", false)
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"))!
    expect(scriptSrc).toContain("'nonce-abc123'")
    expect(scriptSrc).toContain("'strict-dynamic'")
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })

  it("omits unsafe-eval in production", () => {
    const scriptSrc = buildCsp("n", false).split(";").find((d) => d.trim().startsWith("script-src"))!
    expect(scriptSrc).not.toContain("'unsafe-eval'")
  })

  it("allows unsafe-eval only in development (HMR)", () => {
    const scriptSrc = buildCsp("n", true).split(";").find((d) => d.trim().startsWith("script-src"))!
    expect(scriptSrc).toContain("'unsafe-eval'")
  })

  it("nonces style-src in production instead of unsafe-inline", () => {
    const csp = buildCsp("abc123", false)
    const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src "))!
    expect(styleSrc).toContain("'nonce-abc123'")
    expect(styleSrc).not.toContain("'unsafe-inline'")
  })

  it("keeps unsafe-inline on style-src in development (HMR injects un-nonced styles)", () => {
    const csp = buildCsp("n", true)
    const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src "))!
    expect(styleSrc).toContain("'unsafe-inline'")
    expect(styleSrc).not.toContain("'nonce-")
  })

  it("allows inline style attributes via style-src-attr (React/recharts inline styles)", () => {
    const csp = buildCsp("n", false)
    expect(csp).toContain("style-src-attr 'unsafe-inline'")
  })

  it("sets object-src none + frame-ancestors none + default-src self", () => {
    const csp = buildCsp("n", false)
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("default-src 'self'")
  })

  it("allows the Cloudflare Turnstile origin in script-src, frame-src, connect-src", () => {
    const csp = buildCsp("n", false)
    const dir = (name: string) => csp.split(";").find((d) => d.trim().startsWith(name))!
    expect(dir("script-src")).toContain("https://challenges.cloudflare.com")
    expect(dir("frame-src")).toContain("https://challenges.cloudflare.com")
    expect(dir("connect-src")).toContain("https://challenges.cloudflare.com")
  })

  it("accepts a real base64(UUID) nonce", () => {
    const nonce = Buffer.from("2f8a1c3e-4b5d-6e7f-8a9b-0c1d2e3f4a5b").toString("base64")
    expect(() => buildCsp(nonce, false)).not.toThrow()
  })

  it("rejects a nonce with header-injection characters", () => {
    expect(() => buildCsp("x' 'unsafe-inline", false)).toThrow()
    expect(() => buildCsp("x; script-src *", false)).toThrow()
    expect(() => buildCsp("x\ninjected", false)).toThrow()
    expect(() => buildCsp("", false)).toThrow()
  })
})

describe("SECURITY_HEADERS", () => {
  it("carries the static security headers applied by middleware to every response", () => {
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff")
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY")
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toContain("max-age=")
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin")
    expect(SECURITY_HEADERS["Permissions-Policy"]).toContain("geolocation=()")
    expect(SECURITY_HEADERS["Permissions-Policy"]).toContain("microphone=()")
    // camera enabled for our own origin only — QR check-in scanner
    expect(SECURITY_HEADERS["Permissions-Policy"]).toContain("camera=(self)")
  })

  it("sets cross-origin isolation headers but omits COEP", () => {
    expect(SECURITY_HEADERS["Cross-Origin-Opener-Policy"]).toBe("same-origin")
    expect(SECURITY_HEADERS["Cross-Origin-Resource-Policy"]).toBe("same-origin")
    // COEP require-corp would break external event images (img-src https:)
    expect(SECURITY_HEADERS["Cross-Origin-Embedder-Policy"]).toBeUndefined()
  })
})

describe("isPublicPath", () => {
  it("treats auth and public-event paths as public", () => {
    expect(isPublicPath("/login")).toBe(true)
    expect(isPublicPath("/forgot-password")).toBe(true)
    expect(isPublicPath("/reset-password")).toBe(true)
    expect(isPublicPath("/api/auth/callback")).toBe(true)
    expect(isPublicPath("/api/health")).toBe(true)
    expect(isPublicPath("/api/stripe/webhook")).toBe(true)
    // Every bearer-gated cron route must bypass the session gate, or the
    // middleware 302s the scheduler to /login and the job silently never runs.
    for (const cron of ["send-reminders", "sweep-checkouts", "send-celebrations", "error-issues"]) {
      expect(isPublicPath(`/api/cron/${cron}`)).toBe(true)
    }
    expect(isPublicPath("/e/spring-fair")).toBe(true)
    expect(isPublicPath("/api/events/spring-fair/register")).toBe(true)
    expect(isPublicPath("/api/events/spring-fair/waitlist")).toBe(true)
  })

  it("treats app routes as non-public", () => {
    expect(isPublicPath("/")).toBe(false)
    expect(isPublicPath("/people")).toBe(false)
    expect(isPublicPath("/accounting/transactions")).toBe(false)
  })

  it("rejects prefix collisions on public paths", () => {
    expect(isPublicPath("/loginX")).toBe(false)
    expect(isPublicPath("/forgot-passwordXYZ")).toBe(false)
    expect(isPublicPath("/api/healthcheck")).toBe(false)
    expect(isPublicPath("/api/stripe/webhookX")).toBe(false)
  })

  it("gates bare /e and non-register event API routes", () => {
    expect(isPublicPath("/e")).toBe(false)
    expect(isPublicPath("/api/events/spring-fair/export-csv")).toBe(false)
    expect(isPublicPath("/api/events/")).toBe(false)
  })

  it("gates unknown sub-paths under /e/ instead of auto-exposing them", () => {
    expect(isPublicPath("/e/spring-fair/edit")).toBe(false)
    expect(isPublicPath("/e/spring-fair/manage")).toBe(false)
    expect(isPublicPath("/e/admin/settings")).toBe(false)
  })

  it("allows the token-gated volunteer crew view under /e/", () => {
    expect(isPublicPath("/e/spring-fair/crew/abc123")).toBe(true)
    // but not the bare /crew index or a missing token
    expect(isPublicPath("/e/spring-fair/crew")).toBe(false)
  })

  it("allows event success page and bare /api/auth", () => {
    expect(isPublicPath("/e/spring-fair/success")).toBe(true)
    expect(isPublicPath("/api/auth")).toBe(true)
  })

  it("normalizes a trailing slash so public routes stay public", () => {
    expect(isPublicPath("/login/")).toBe(true)
    expect(isPublicPath("/privacy/")).toBe(true)
    expect(isPublicPath("/e/spring-fair/")).toBe(true)
    // normalization must not open a protected route
    expect(isPublicPath("/people/")).toBe(false)
    expect(isPublicPath("/accounting/")).toBe(false)
  })

  it("treats /privacy as public but not sub-paths or collisions", () => {
    expect(isPublicPath("/privacy")).toBe(true)
    expect(isPublicPath("/privacyX")).toBe(false)
    expect(isPublicPath("/privacy/extra")).toBe(false)
  })

  it("treats /robots.txt as public", () => {
    // public/robots.txt is a static asset the middleware matcher does not
    // exclude (only _next/static, _next/image, favicon.ico are), so without
    // this an unauthenticated crawler gets a 302-to-login instead of the
    // Disallow-all file.
    expect(isPublicPath("/robots.txt")).toBe(true)
    expect(isPublicPath("/robots.txtX")).toBe(false)
  })

  it("treats the family update form as public", () => {
    expect(isPublicPath("/family/update/abc123")).toBe(true)
  })
  it("keeps bare /family gated", () => {
    expect(isPublicPath("/family")).toBe(false)
    expect(isPublicPath("/families")).toBe(false)
  })

  it("branding assets are public", () => {
    expect(isPublicPath("/api/branding/logo")).toBe(true)
    expect(isPublicPath("/api/branding/letterhead")).toBe(true)
  })
})
