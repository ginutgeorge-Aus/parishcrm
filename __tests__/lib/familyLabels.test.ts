import { genderLabel, FAMILY_STATUS_LABELS } from "@/lib/familyLabels"

describe("genderLabel (AUD-8-15)", () => {
  it("maps enum values to readable labels", () => {
    expect(genderLabel("MALE")).toBe("Male")
    expect(genderLabel("FEMALE")).toBe("Female")
    expect(genderLabel("OTHER")).toBe("Other")
  })
  it("returns null for empty and passes unknown values through", () => {
    expect(genderLabel(null)).toBeNull()
    expect(genderLabel("")).toBeNull()
    expect(genderLabel("X")).toBe("X")
  })
  it("family status labels are humanized", () => {
    expect(FAMILY_STATUS_LABELS.ACTIVE).toBe("Active")
  })
})
