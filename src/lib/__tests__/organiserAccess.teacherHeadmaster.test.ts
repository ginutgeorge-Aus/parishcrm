import { isHeadmasterAllowedPath, isTeacherAllowedPath } from "@/lib/organiserAccess"

// Shared infra a confined login always needs (auth, assets, health, public pages).
const INFRA = ["/api/auth/session", "/_next/data/abc.json", "/api/health", "/login", "/e/summer-fete"]

describe("isTeacherAllowedPath", () => {
  test.each(["/my-classes", "/my-classes/3/roll", "/account", "/account/security", "/help", ...INFRA])("allows %s", (p) =>
    expect(isTeacherAllowedPath(p)).toBe(true),
  )

  test.each([
    "/",
    "/my-events",
    "/my-events/42/registrations",
    "/my-groups",
    "/my-classesx",
    "/people",
    "/people/4",
    "/families",
    "/accounting",
    "/sunday-school",
    "/sunday-school/3",
    "/api/events/summer-fete/export-csv",
    "/api/events/summer-fete/register",
    "/events/42/registrations/print",
    "/api/cron/x",
  ])("blocks %s", (p) => expect(isTeacherAllowedPath(p)).toBe(false))
})

describe("isHeadmasterAllowedPath", () => {
  test.each(["/sunday-school", "/sunday-school/3", "/sunday-school/3/roll", "/account", "/help", ...INFRA])(
    "allows %s",
    (p) => expect(isHeadmasterAllowedPath(p)).toBe(true),
  )

  test.each([
    "/",
    "/people",
    "/people/4",
    "/families",
    "/accounting",
    "/accounting/transactions",
    "/users",
    "/groups",
    "/events",
    "/my-events",
    "/my-classes",
    "/sunday-schoolx",
    "/api/cron/x",
    "/api/people/search",
    "/api/events/summer-fete/export-csv",
    "/api/events/summer-fete/register",
  ])("blocks %s", (p) => expect(isHeadmasterAllowedPath(p)).toBe(false))
})
