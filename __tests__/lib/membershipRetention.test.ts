import {
  membershipRetentionCutoff,
  isApplicationPastRetention,
  anonymisedMembershipApplicationData,
  MEMBERSHIP_RETENTION_MONTHS,
  REDACTED_APPLICANT_NAME,
} from "@/lib/membershipRetention"

describe("membershipRetentionCutoff", () => {
  it("subtracts whole months for a mid-month date (no rollover)", () => {
    const cutoff = membershipRetentionCutoff(new Date(2027, 7, 15, 9, 30), 24) // 15 Aug 2027
    expect(cutoff.getFullYear()).toBe(2025)
    expect(cutoff.getMonth()).toBe(7) // August
    expect(cutoff.getDate()).toBe(15)
  })

  it("defaults to MEMBERSHIP_RETENTION_MONTHS", () => {
    const a = membershipRetentionCutoff(new Date(2026, 5, 15))
    const b = membershipRetentionCutoff(new Date(2026, 5, 15), MEMBERSHIP_RETENTION_MONTHS)
    expect(a.getTime()).toBe(b.getTime())
  })
})

describe("isApplicationPastRetention", () => {
  const now = new Date(2027, 7, 31, 12, 0) // 31 Aug 2027 → cutoff ~31 Aug 2025

  it("purges a decided (APPROVED) application reviewed before the cutoff", () => {
    expect(isApplicationPastRetention("APPROVED", new Date(2025, 0, 1), now, 24)).toBe(true)
  })

  it("purges a decided (REJECTED) application reviewed before the cutoff", () => {
    expect(isApplicationPastRetention("REJECTED", new Date(2025, 0, 1), now, 24)).toBe(true)
  })

  it("keeps a decided application reviewed on/after the cutoff", () => {
    expect(isApplicationPastRetention("APPROVED", new Date(2026, 5, 1), now, 24)).toBe(false)
  })

  it("never purges a PENDING application, even with an old reviewedAt-like date", () => {
    expect(isApplicationPastRetention("PENDING", new Date(2020, 0, 1), now, 24)).toBe(false)
  })

  it("never purges a decided application with no reviewedAt anchor", () => {
    expect(isApplicationPastRetention("APPROVED", null, now, 24)).toBe(false)
  })
})

describe("anonymisedMembershipApplicationData", () => {
  it("redacts applicant name, blanks signature/email, clears hashes, and sets the marker", () => {
    const now = new Date(2027, 7, 31, 12, 0)
    expect(anonymisedMembershipApplicationData(now)).toEqual({
      applicantName: REDACTED_APPLICANT_NAME,
      signature: "",
      email: "",
      emailHash: null,
      mobile: null,
      mobileHash: null,
      anonymizedAt: now,
    })
  })
})
