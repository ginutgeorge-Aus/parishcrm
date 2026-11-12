import { UserRole } from "@/lib/generated/prisma/enums"
import { buildNavGroups, type NavItem } from "../sidebar/navData"
import { navFlagsFor } from "../navGates"

/** Visible attendance links (href -> label) for a role. */
function attendanceLinks(role: UserRole | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const g of buildNavGroups(navFlagsFor(role))) {
    for (const e of g.items) {
      const items: NavItem[] = "subLabel" in e ? e.items : [e]
      for (const i of items) if (i.href.startsWith("/attendance") && i.show) out[i.href] = i.label
    }
  }
  return out
}

describe("attendance nav entries", () => {
  it.each([UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN])("%s sees Attendance (entry) and trends", (role) => {
    expect(attendanceLinks(role)).toEqual({ "/attendance": "Attendance", "/attendance/trends": "Attendance trends" })
  })

  it("VIEWER sees only the trends link", () => {
    expect(attendanceLinks(UserRole.VIEWER)).toEqual({ "/attendance/trends": "Attendance trends" })
  })

  it.each([UserRole.AUDITOR, UserRole.EVENT_ORGANISER, undefined])("%s sees nothing", (role) => {
    expect(attendanceLinks(role)).toEqual({})
  })

  it("every attendance link has its own icon", () => {
    const att = buildNavGroups(navFlagsFor(UserRole.ADMIN))
      .flatMap((g) => g.items)
      .flatMap((e) => ("subLabel" in e ? e.items : [e]))
      .filter((i) => i.href.startsWith("/attendance"))
    expect(att).toHaveLength(2)
    expect(new Set(att.map((i) => i.icon)).size).toBe(2)
    expect(att.every((i) => !!i.icon)).toBe(true)
  })
})
