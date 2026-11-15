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

describe("Sacraments nav entry", () => {
  it.each([UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN])("%s sees it", (role) =>
    expect(visibleHrefs(role)).toContain("/sacraments"),
  )

  it.each([UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER, UserRole.HEADMASTER, UserRole.TEACHER])(
    "%s does not",
    (role) => expect(visibleHrefs(role)).not.toContain("/sacraments"),
  )
})
