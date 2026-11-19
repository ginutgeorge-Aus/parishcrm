import { mintRegistrationToken, REGISTRATION_TOKEN_RE } from "@/lib/registrationLink"

describe("mintRegistrationToken", () => {
  it("mints tokens that match REGISTRATION_TOKEN_RE", () => {
    expect(mintRegistrationToken()).toMatch(REGISTRATION_TOKEN_RE)
  })

  it("mints distinct tokens", () => {
    expect(mintRegistrationToken()).not.toBe(mintRegistrationToken())
  })
})
