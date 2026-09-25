import { FamilyUpdatePayloadSchema } from "@/lib/familyUpdatePayload"

const valid = {
  family: { address: "1 St", suburb: "Springfield", state: "NSW", postcode: "2300", homePhone: "0249000000" },
  members: [
    { personId: 5, title: "Mr", firstName: "Jon", middleName: null, lastName: "Smith", suffix: null,
      gender: "MALE", dateOfBirth: "1990-02-01", email: "j@x.com", mobile: "0400000000", workPhone: null, homePhone: null },
    { firstName: "Baby", lastName: "Smith" },
  ],
}

describe("FamilyUpdatePayloadSchema", () => {
  it("accepts a valid payload", () => {
    expect(FamilyUpdatePayloadSchema.safeParse(valid).success).toBe(true)
  })
  it("strips disallowed fields (pastoralNotes/role/monthlyDues) — they never reach output", () => {
    const dirty = {
      family: { ...valid.family, monthlyDues: 999, memberNo: "C1/1", status: "INACTIVE" },
      members: [{ firstName: "A", lastName: "B", pastoralNotes: "secret", role: "HEAD", classification: "MEMBER", bankingName: "X" }],
    }
    const parsed = FamilyUpdatePayloadSchema.parse(dirty)
    expect(parsed.family).not.toHaveProperty("monthlyDues")
    expect(parsed.family).not.toHaveProperty("memberNo")
    expect(parsed.family).not.toHaveProperty("status")
    expect(parsed.members[0]).not.toHaveProperty("pastoralNotes")
    expect(parsed.members[0]).not.toHaveProperty("role")
    expect(parsed.members[0]).not.toHaveProperty("classification")
    expect(parsed.members[0]).not.toHaveProperty("bankingName")
  })
  it("rejects a member with no firstName/lastName", () => {
    expect(FamilyUpdatePayloadSchema.safeParse({ family: {}, members: [{ firstName: "" }] }).success).toBe(false)
  })
  it("rejects whitespace-only firstName/lastName and trims surrounding whitespace", () => {
    expect(FamilyUpdatePayloadSchema.safeParse({ family: {}, members: [{ firstName: "   ", lastName: "Smith" }] }).success).toBe(false)
    expect(FamilyUpdatePayloadSchema.safeParse({ family: {}, members: [{ firstName: "Jon", lastName: "  " }] }).success).toBe(false)
    const parsed = FamilyUpdatePayloadSchema.parse({ family: {}, members: [{ firstName: "  Jon  ", lastName: " Smith " }] })
    expect(parsed.members[0].firstName).toBe("Jon")
    expect(parsed.members[0].lastName).toBe("Smith")
  })
  it("rejects a calendar-impossible ISO dateOfBirth / marriageDate", () => {
    expect(FamilyUpdatePayloadSchema.safeParse({ family: {}, members: [{ firstName: "A", lastName: "B", dateOfBirth: "2024-02-31" }] }).success).toBe(false)
    expect(FamilyUpdatePayloadSchema.safeParse({ family: {}, members: [{ firstName: "A", lastName: "B", dateOfBirth: "2024-13-01" }] }).success).toBe(false)
    expect(FamilyUpdatePayloadSchema.safeParse({ family: { marriageDate: "2023-02-29" }, members: [{ firstName: "A", lastName: "B" }] }).success).toBe(false)
  })
  it("rejects an invalid gender", () => {
    const bad = { family: {}, members: [{ firstName: "A", lastName: "B", gender: "ROBOT" }] }
    expect(FamilyUpdatePayloadSchema.safeParse(bad).success).toBe(false)
  })
  it("caps the member array length", () => {
    const many = { family: {}, members: Array.from({ length: 51 }, () => ({ firstName: "A", lastName: "B" })) }
    expect(FamilyUpdatePayloadSchema.safeParse(many).success).toBe(false)
  })
  it("rejects a member email that is not a valid address", () => {
    const bad = { family: {}, members: [{ firstName: "A", lastName: "B", email: "not-an-email" }] }
    expect(FamilyUpdatePayloadSchema.safeParse(bad).success).toBe(false)
  })
  it("accepts a valid member email and coerces empty/whitespace to null", () => {
    const parsed = FamilyUpdatePayloadSchema.parse({
      family: {},
      members: [
        { firstName: "A", lastName: "B", email: "good@example.com" },
        { firstName: "C", lastName: "D", email: "   " },
      ],
    })
    expect(parsed.members[0].email).toBe("good@example.com")
    expect(parsed.members[1].email).toBeNull()
  })
  it("rejects a non-ISO member dateOfBirth", () => {
    const bad = { family: {}, members: [{ firstName: "A", lastName: "B", dateOfBirth: "01/02/1990" }] }
    expect(FamilyUpdatePayloadSchema.safeParse(bad).success).toBe(false)
  })
  it("coerces an empty member dateOfBirth to null", () => {
    const parsed = FamilyUpdatePayloadSchema.parse({ family: {}, members: [{ firstName: "A", lastName: "B", dateOfBirth: "  " }] })
    expect(parsed.members[0].dateOfBirth).toBeNull()
  })
  it("accepts a valid ISO marriageDate on family", () => {
    const p = { ...valid, family: { ...valid.family, marriageDate: "1990-02-01" } }
    const parsed = FamilyUpdatePayloadSchema.parse(p)
    expect(parsed.family.marriageDate).toBe("1990-02-01")
  })
  it("coerces an empty marriageDate to null", () => {
    const p = { ...valid, family: { ...valid.family, marriageDate: "" } }
    expect(FamilyUpdatePayloadSchema.parse(p).family.marriageDate).toBeNull()
  })
  it("rejects a non-ISO marriageDate", () => {
    const p = { ...valid, family: { ...valid.family, marriageDate: "01/02/1990" } }
    expect(FamilyUpdatePayloadSchema.safeParse(p).success).toBe(false)
  })
  it("defaults marriageDate to null when absent", () => {
    expect(FamilyUpdatePayloadSchema.parse(valid).family.marriageDate).toBeNull()
  })
})
