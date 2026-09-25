import { isOrganiserAllowedPath } from "@/lib/organiserAccess"

describe("isOrganiserAllowedPath", () => {
  test.each([
    "/my-events",
    "/my-events/42/registrations",
    "/api/auth/session",
    "/_next/data/abc.json",
    "/api/health",
    "/login",
    "/e/summer-fete",
    "/api/events/summer-fete/export-csv",
    "/events/42/registrations/print",
  ])("allows %s", (p) => expect(isOrganiserAllowedPath(p)).toBe(true))

  test.each([
    "/",
    "/people",
    "/families",
    "/accounting",
    "/users",
    "/events",
    "/events/42/registrations",
    "/api/events/summer-fete/register",
  ])("blocks %s", (p) => expect(isOrganiserAllowedPath(p)).toBe(false))
})
