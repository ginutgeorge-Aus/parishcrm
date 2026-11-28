/** @jest-environment node */
import { authConfig } from "@/auth.config"
import { SESSION_MAX_AGE_SECONDS } from "@/lib/sessionWindows"

describe("authConfig (middleware instance)", () => {
  // AUD-1-06: without an explicit maxAge the middleware re-issues the cookie with NextAuth's 30-day default.
  it("caps the JWT cookie at 7 days, from the shared constant", () => {
    expect(authConfig.session?.strategy).toBe("jwt")
    expect(authConfig.session?.maxAge).toBe(SESSION_MAX_AGE_SECONDS)
    expect(SESSION_MAX_AGE_SECONDS).toBe(604800)
  })
})
