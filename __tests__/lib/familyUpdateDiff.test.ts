import { diffFamilyUpdate } from "@/lib/familyUpdateDiff"

describe("diffFamilyUpdate", () => {
  const current = {
    family: { address: "1 Old St", suburb: "Springfield", state: "NSW", postcode: "2300", homePhone: null },
    members: [{ personId: 5, firstName: "Jon", lastName: "Smith", email: "old@x.com", mobile: null,
                title: null, middleName: null, suffix: null, gender: "MALE", dateOfBirth: null, workPhone: null, homePhone: null }],
  }
  it("flags changed family fields only", () => {
    const proposed = { family: { ...current.family, address: "2 New St" }, members: current.members }
    const d = diffFamilyUpdate(current as never, proposed as never)
    const addr = d.family.find((f) => f.field === "address")
    expect(addr).toEqual({ field: "address", from: "1 Old St", to: "2 New St", changed: true })
    expect(d.family.find((f) => f.field === "suburb")?.changed).toBe(false)
  })
  it("matches existing members by personId and flags new members", () => {
    const proposed = {
      family: current.family,
      members: [
        { ...current.members[0], email: "new@x.com" },
        { firstName: "Baby", lastName: "Smith", title: null, middleName: null, suffix: null, gender: null,
          dateOfBirth: null, email: null, mobile: null, workPhone: null, homePhone: null },
      ],
    }
    const d = diffFamilyUpdate(current as never, proposed as never)
    expect(d.members[0].isNew).toBe(false)
    expect(d.members[0].fields.find((f) => f.field === "email")?.changed).toBe(true)
    expect(d.members[1].isNew).toBe(true)
  })
  it("flags a changed marriageDate in the family diff", () => {
    const cur = { family: { address: null, suburb: null, state: null, postcode: null, homePhone: null, marriageDate: null }, members: [] }
    const prop = { family: { address: null, suburb: null, state: null, postcode: null, homePhone: null, marriageDate: "1990-02-01" }, members: [] }
    const d = diffFamilyUpdate(cur as never, prop as never)
    const row = d.family.find((r) => r.field === "marriageDate")
    expect(row).toEqual({ field: "marriageDate", from: null, to: "1990-02-01", changed: true })
  })
})
