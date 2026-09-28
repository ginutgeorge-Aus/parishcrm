/** @jest-environment node */
import { buildDisplayPerson, groupTransactionsByYear } from "@/lib/personDetailView"

describe("buildDisplayPerson", () => {
  const base = {
    email: "a@b.com",
    dateOfBirth: "1990-01-15",
    mobile: "0400000000",
    workPhone: null,
    homePhone: null,
    notes: "some notes",
    pastoralNotes: "sensitive",
    emergencyContactName: "Jane Doe",
    emergencyContactPhone: "0411111111",
  }

  test("decrypts plain (non-encrypted-shape) fields as-is and parses DOB", () => {
    const result = buildDisplayPerson(base, true)
    expect(result.email).toBe("a@b.com")
    expect(result.mobile).toBe("0400000000")
    expect(result.notes).toBe("some notes")
    expect(result.dateOfBirth).toEqual(new Date("1990-01-15"))
  })

  test("nulls pass through untouched", () => {
    const result = buildDisplayPerson(base, true)
    expect(result.workPhone).toBeNull()
    expect(result.homePhone).toBeNull()
  })

  test("hides pastoral/emergency fields when showPastoralNotes is false", () => {
    const result = buildDisplayPerson(base, false)
    expect(result.pastoralNotes).toBeNull()
    expect(result.emergencyContactName).toBeNull()
    expect(result.emergencyContactPhone).toBeNull()
  })

  test("shows pastoral/emergency fields when showPastoralNotes is true", () => {
    const result = buildDisplayPerson(base, true)
    expect(result.pastoralNotes).toBe("sensitive")
    expect(result.emergencyContactName).toBe("Jane Doe")
    expect(result.emergencyContactPhone).toBe("0411111111")
  })

  test("null dateOfBirth stays null", () => {
    const result = buildDisplayPerson({ ...base, dateOfBirth: null }, true)
    expect(result.dateOfBirth).toBeNull()
  })
})

describe("groupTransactionsByYear", () => {
  test("buckets transactions by UTC calendar year", () => {
    const txns = [
      { id: 1, date: new Date("2023-06-01T00:00:00Z") },
      { id: 2, date: new Date("2024-01-10T00:00:00Z") },
      { id: 3, date: new Date("2023-12-31T00:00:00Z") },
    ]
    const result = groupTransactionsByYear(txns)
    expect(Object.keys(result).map(Number).sort()).toEqual([2023, 2024])
    expect(result[2023]).toEqual([txns[0], txns[2]])
    expect(result[2024]).toEqual([txns[1]])
  })

  test("empty input yields empty map", () => {
    expect(groupTransactionsByYear([])).toEqual({})
  })
})
