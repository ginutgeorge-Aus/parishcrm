import { isOrganiserAllowedPath } from "@/lib/organiserAccess"

describe("isOrganiserAllowedPath", () => {
  test.each([
    "/my-events",
    "/my-events/42/registrations",
    "/my-events/42/edit",
    "/my-classes",
    "/my-classes/4/roll",
    "/my-groups",
    "/my-groups/4",
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
    "/events/42/edit",
    "/events/42/registrations",
    "/api/events/summer-fete/register",
    "/sunday-school",
    "/sunday-school/4/roll",
    "/my-classesx",
    "/groups",
    "/groups/4",
    "/groups/4/print",
    "/api/groups/4/export-csv",
    "/my-groupsx",
  ])("blocks %s", (p) => expect(isOrganiserAllowedPath(p)).toBe(false))
})
