import {
  ROSTER_FEED_TOKEN_RE, hashRosterFeedToken, mintRosterFeedToken, rosterFeedTokenMatches, rosterFeedUrl,
} from "@/lib/rosterFeed"
import { isPublicPath } from "@/lib/csp"

describe("roster feed token", () => {
  it("mints distinct 32-char base64url tokens", () => {
    const a = mintRosterFeedToken()
    const b = mintRosterFeedToken()
    expect(a).toMatch(ROSTER_FEED_TOKEN_RE)
    expect(a).not.toBe(b)
  })

  it("hashes to a stable 64-char hex digest that is not the token", () => {
    const t = mintRosterFeedToken()
    expect(hashRosterFeedToken(t)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashRosterFeedToken(t)).toBe(hashRosterFeedToken(t))
    expect(hashRosterFeedToken(t)).not.toContain(t)
  })

  it("matches only the right token", () => {
    const t = mintRosterFeedToken()
    const h = hashRosterFeedToken(t)
    expect(rosterFeedTokenMatches(t, h)).toBe(true)
    expect(rosterFeedTokenMatches(mintRosterFeedToken(), h)).toBe(false)
    expect(rosterFeedTokenMatches("short", h)).toBe(false)
    expect(rosterFeedTokenMatches(t, "")).toBe(false)
    expect(rosterFeedTokenMatches(t, "abc")).toBe(false)
  })

  it("builds the feed URL from AUTH_URL", () => {
    const prev = process.env.AUTH_URL
    process.env.AUTH_URL = "https://app.example.com"
    expect(rosterFeedUrl("tok")).toBe("https://app.example.com/api/roster/feed/tok")
    process.env.AUTH_URL = "not a url"
    expect(rosterFeedUrl("tok")).toBeNull()
    if (prev === undefined) delete process.env.AUTH_URL
    else process.env.AUTH_URL = prev
  })
})

describe("roster feed path is public, other roster paths are not", () => {
  it.each(["/api/roster/feed/abc_DEF-123", "/api/roster/feed/abc_DEF-123.ics"])("%s is public", (p) => {
    expect(isPublicPath(p)).toBe(true)
  })
  it.each(["/api/roster", "/api/roster/feed", "/api/roster/feed/a/b", "/roster", "/roster/1"])("%s stays gated", (p) => {
    expect(isPublicPath(p)).toBe(false)
  })
})
