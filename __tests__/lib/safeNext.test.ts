import { safeNextPath, loginRedirectPath } from "@/lib/safeNext"

describe("safeNextPath", () => {
  it.each([
    ["/people/123", "/people/123"],
    ["/people?q=a&page=2", "/people?q=a&page=2"],
    ["/events/1#top", "/events/1#top"],
    ["/", "/"],
  ])("accepts same-origin path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected)
  })

  it.each([
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "\\/evil.com",
    "/path\\with\\backslash",
    "https://evil.com",
    "http://evil.com/x",
    "javascript:alert(1)",
    "data:text/html,x",
    "evil.com",
    "people/1",
    "",
    " /people",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "/\u0000x",
    "/\u007fx",
    "/ok\u001bx",
    "/" + "a".repeat(3000),
  ])("rejects %j", (input) => {
    expect(safeNextPath(input)).toBe("/")
  })

  it.each([null, undefined, 42, {}, ["/x"]])("falls back for non-string %j", (input) => {
    expect(safeNextPath(input as unknown)).toBe("/")
  })

  it("never redirects back to the login page", () => {
    expect(safeNextPath("/login")).toBe("/")
    expect(safeNextPath("/login?next=/x")).toBe("/")
  })
})

describe("loginRedirectPath", () => {
  it("returns bare /login for the dashboard root", () => {
    expect(loginRedirectPath("/", "")).toBe("/login")
  })

  it("carries pathname + search, encoded", () => {
    expect(loginRedirectPath("/people/123", "")).toBe("/login?next=%2Fpeople%2F123")
    expect(loginRedirectPath("/people", "?q=a&p=2")).toBe("/login?next=%2Fpeople%3Fq%3Da%26p%3D2")
  })

  it("omits next when the target would not validate", () => {
    expect(loginRedirectPath("//evil.com", "")).toBe("/login")
  })
})
