/** @jest-environment node */
// Role confinement branches of src/middleware.ts (TEACHER, HEADMASTER, EVENT_ORGANISER).
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
  isFeatureRouteOff: jest.fn().mockResolvedValue(false),
  featureOffRedirect: jest.fn().mockReturnValue(null),
}))

import middleware from "@/middleware"

const run = middleware as unknown as (req: unknown) => Promise<NextResponse>
const req = (pathname: string, role: string) => ({
  method: "GET",
  nextUrl: new URL(`http://localhost${pathname}`),
  headers: new Headers(),
  auth: { user: { role } },
})
const location = (res: NextResponse) => res.headers.get("location")

describe("middleware role confinement", () => {
  it("redirects a TEACHER off /people to /my-classes", async () => {
    const res = await run(req("/people", "TEACHER"))
    expect(location(res)).toBe("http://localhost/my-classes")
  })
  it("lets a TEACHER reach /my-classes/4/exams", async () => {
    expect(location(await run(req("/my-classes/4/exams", "TEACHER")))).toBeNull()
  })
  it("redirects a HEADMASTER off /accounting to /sunday-school", async () => {
    expect(location(await run(req("/accounting", "HEADMASTER")))).toBe("http://localhost/sunday-school")
  })
  it("lets a HEADMASTER reach /sunday-school/4/exams", async () => {
    expect(location(await run(req("/sunday-school/4/exams", "HEADMASTER")))).toBeNull()
  })
  it("still redirects an EVENT_ORGANISER off /people to /my-events", async () => {
    expect(location(await run(req("/people", "EVENT_ORGANISER")))).toBe("http://localhost/my-events")
  })
  it("does not confine an ADMIN", async () => {
    expect(location(await run(req("/people", "ADMIN")))).toBeNull()
  })
})
