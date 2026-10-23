import { activeHref } from "../activeHref"

describe("activeHref", () => {
  const all = ["/settings", "/settings/branding", "/settings/audit-log"]
  it("matches exactly", () => expect(activeHref("/settings", all)).toBe("/settings"))
  it("picks the longest separator-bounded prefix", () => {
    expect(activeHref("/settings/branding", all)).toBe("/settings/branding")
    expect(activeHref("/settings/audit-log/123", all)).toBe("/settings/audit-log")
  })
  it("does not match a non-separator prefix", () => {
    expect(activeHref("/settings/brandingx", ["/settings/branding"])).toBeNull()
  })
  it("returns null outside the area", () => expect(activeHref("/users", all)).toBeNull())
  it("matches the root only on the root", () => {
    expect(activeHref("/", ["/", "/people"])).toBe("/")
    expect(activeHref("/people/1", ["/", "/people"])).toBe("/people")
    expect(activeHref("/events", ["/"])).toBeNull()
  })
})
