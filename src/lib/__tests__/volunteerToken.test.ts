import { generateVolunteerToken } from "@/lib/volunteerToken"

describe("generateVolunteerToken", () => {
  it("returns a url-safe string of at least 20 chars", () => {
    const t = generateVolunteerToken()
    expect(t.length).toBeGreaterThanOrEqual(20)
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/) // base64url: no +/=
  })

  it("is unguessable — two calls differ", () => {
    expect(generateVolunteerToken()).not.toBe(generateVolunteerToken())
  })
})
