/** @jest-environment node */
// Behavioural test of the feature-toggle branch in src/middleware.ts. next-auth's
// `auth(handler)` wrapper is stubbed to return the handler, so the middleware
// can be called directly with a fake request.
import { NextResponse } from "next/server"

jest.mock("next-auth", () => ({
  __esModule: true,
  default: () => ({ auth: (handler: unknown) => handler }),
}))
jest.mock("@/auth.config", () => ({ authConfig: {} }))
jest.mock("@/lib/maintenance", () => ({
  getMaintenanceState: jest.fn().mockResolvedValue({ enabled: false }),
  isMaintenanceBypassPath: jest.fn().mockReturnValue(false),
  renderMaintenanceHtml: jest.fn(),
}))
jest.mock("@/lib/featureRoutes", () => ({
  FEATURE_OFF_REWRITE_PATH: "/_feature-off",
  isFeatureRouteOff: jest.fn(),
  featureOffRedirect: jest.fn(),
}))

import middleware from "@/middleware"
import { featureOffRedirect, isFeatureRouteOff } from "@/lib/featureRoutes"

const off = isFeatureRouteOff as jest.Mock
const run = middleware as unknown as (req: unknown) => Promise<NextResponse>

const req = (pathname: string, method = "GET", role = "ADMIN", user = true) => ({
  method,
  nextUrl: new URL(`http://localhost${pathname}`),
  headers: new Headers(),
  auth: user ? { user: { role } } : null,
})

const rewrittenTo = (res: NextResponse) => res.headers.get("x-middleware-rewrite")

const fallback = featureOffRedirect as jest.Mock

beforeEach(() => {
  off.mockReset().mockResolvedValue(true)
  fallback.mockReset().mockReturnValue(null)
})

describe("middleware feature gate", () => {
  it("rewrites a GET to a feature that is off to the 404 path", async () => {
    const res = await run(req("/accounting/invoices"))
    expect(off).toHaveBeenCalledWith("/accounting/invoices")
    expect(rewrittenTo(res)).toContain("/_feature-off")
  })

  it("forwards the nonce and CSP request headers on the rewrite", async () => {
    const res = await run(req("/events"))
    const nonce = res.headers.get("x-middleware-request-x-nonce")
    expect(nonce).toMatch(/^[A-Za-z0-9+/=_-]{16,}$/)
    expect(res.headers.get("x-middleware-request-content-security-policy")).toContain(`'nonce-${nonce}'`)
    expect(res.headers.get("Content-Security-Policy")).toContain("nonce-")
  })

  it("redirects to the fallback path instead of a 404 when the route has one", async () => {
    fallback.mockReturnValue("/my-events")
    const res = await run(req("/my-events/42/check-in", "GET", "EVENT_ORGANISER"))
    expect(rewrittenTo(res)).toBeNull()
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get("location")!).pathname).toBe("/my-events")
    expect(res.headers.get("Content-Security-Policy")).toContain("nonce-")
  })

  it("also gates HEAD", async () => {
    expect(rewrittenTo(await run(req("/events", "HEAD")))).toContain("/_feature-off")
  })

  it("lets a GET through when the feature is on", async () => {
    off.mockResolvedValue(false)
    const res = await run(req("/accounting/invoices"))
    expect(rewrittenTo(res)).toBeNull()
    expect(res.headers.get("x-middleware-next")).toBe("1")
  })

  it("does not gate non-GET requests (Server Actions keep their own guard)", async () => {
    const res = await run(req("/accounting/invoices", "POST"))
    expect(off).not.toHaveBeenCalled()
    expect(rewrittenTo(res)).toBeNull()
  })

  it("does not gate /api/ paths", async () => {
    const res = await run(req("/api/accounting/invoices"))
    expect(off).not.toHaveBeenCalled()
    expect(rewrittenTo(res)).toBeNull()
  })

  it("redirects an anonymous caller to login before consulting feature state", async () => {
    const res = await run(req("/accounting/invoices", "GET", "ADMIN", false))
    expect(off).not.toHaveBeenCalled()
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login")
  })
})
