/** @jest-environment node */
import {
  isDemoMode, assertNotDemo, isDemoEmail, DEMO_ERROR, DEMO_LOGINS, DEMO_EMAIL_DOMAIN,
} from "@/lib/demoMode"

describe("demoMode", () => {
  const saved = process.env.DEMO_MODE
  afterEach(() => {
    if (saved === undefined) delete process.env.DEMO_MODE
    else process.env.DEMO_MODE = saved
  })

  it("is on only for the exact string 'true'", () => {
    expect(isDemoMode({ DEMO_MODE: "true" })).toBe(true)
    expect(isDemoMode({ DEMO_MODE: "TRUE" })).toBe(false)
    expect(isDemoMode({ DEMO_MODE: "1" })).toBe(false)
    expect(isDemoMode({})).toBe(false)
  })

  it("assertNotDemo returns the demo error only in demo mode", () => {
    delete process.env.DEMO_MODE
    expect(assertNotDemo()).toBeNull()
    process.env.DEMO_MODE = "true"
    expect(assertNotDemo()).toEqual({ error: DEMO_ERROR })
  })

  it("isDemoEmail matches the reserved domain only, case-insensitively", () => {
    expect(isDemoEmail("admin@demo.invalid")).toBe(true)
    expect(isDemoEmail("Admin@DEMO.invalid")).toBe(true)
    expect(isDemoEmail("admin@demo.invalid.evil.com")).toBe(false)
    expect(isDemoEmail("admin@example.com")).toBe(false)
  })

  it("has one login per role, all on the reserved domain", () => {
    expect(DEMO_LOGINS.map((l) => l.role).sort()).toEqual(
      ["ADMIN", "AUDITOR", "EVENT_ORGANISER", "OFFICE_ADMIN", "PASTOR", "VIEWER"],
    )
    for (const l of DEMO_LOGINS) expect(l.email.endsWith(DEMO_EMAIL_DOMAIN)).toBe(true)
  })
})
