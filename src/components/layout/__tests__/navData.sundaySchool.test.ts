import { UserRole } from "@/lib/generated/prisma/enums"
import { buildNavGroups, flattenNavItems } from "../sidebar/navData"
import { navFlagsFor } from "../navGates"

/** Hrefs of the visible sidebar links for a role (all features on). */
function visibleHrefs(role: UserRole | undefined): string[] {
  return buildNavGroups(navFlagsFor(role))
    .flatMap((g) => flattenNavItems(g.items))
    .filter((i) => i.show)
    .map((i) => i.href)
}

describe("Sunday School nav entry", () => {
  it.each([UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN, UserRole.VIEWER, UserRole.HEADMASTER])(
    "%s sees Sunday School",
    (role) => expect(visibleHrefs(role)).toContain("/sunday-school"),
  )

  it.each([UserRole.AUDITOR, UserRole.EVENT_ORGANISER])("%s does not", (role) => {
    expect(visibleHrefs(role)).not.toContain("/sunday-school")
  })

  // Middleware confines HEADMASTER to /sunday-school, /account and /help, so the
  // sidebar shows only those — no Dashboard or feedback link that would bounce.
  it("HEADMASTER sees only the paths it may reach", () => {
    expect(visibleHrefs(UserRole.HEADMASTER)).toEqual(["/sunday-school", "/account", "/help"])
  })
})
