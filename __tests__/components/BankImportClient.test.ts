/**
 * @jest-environment node
 */
import { applyCategoryToRows, matchPerson } from "@/components/accounting/BankImportClient"
import type { ReviewRow } from "@/components/accounting/BankReviewTable"

const families = [
  {
    id: 1,
    name: "Smith",
    people: [
      { id: 10, firstName: "John", lastName: "Smith", bankingName: null },
      { id: 11, firstName: "Mary", lastName: "Smith", bankingName: null },
    ],
  },
  {
    id: 2,
    name: "Jones",
    people: [{ id: 20, firstName: "Alice", lastName: "Jones", bankingName: null }],
  },
]

describe("matchPerson", () => {
  it("matches person by full name in description", () => {
    expect(matchPerson("PAYMENT FROM JOHN SMITH", families)).toEqual({
      familyId: 1,
      personId: 10,
    })
  })

  it("matches case-insensitively", () => {
    expect(matchPerson("payment from john smith ref123", families)).toEqual({
      familyId: 1,
      personId: 10,
    })
  })

  it("returns null/null when no match", () => {
    expect(matchPerson("INTERNET BANKING TFR", families)).toEqual({
      familyId: null,
      personId: null,
    })
  })

  it("matches anywhere in combined description+details text", () => {
    expect(matchPerson("PAYMENT FROM ALICE JONES REF 999", families)).toEqual({
      familyId: 2,
      personId: 20,
    })
  })

  it("does not match on family name alone", () => {
    expect(matchPerson("SMITH FAMILY TRUST DONATION", families)).toEqual({
      familyId: null,
      personId: null,
    })
  })

  it("first person match wins (iterates families then people in order)", () => {
    expect(matchPerson("JOHN SMITH TITHE", families)).toEqual({
      familyId: 1,
      personId: 10,
    })
  })

  it("returns null/null for empty families list", () => {
    expect(matchPerson("JOHN SMITH", [])).toEqual({
      familyId: null,
      personId: null,
    })
  })

  it("returns null/null for empty text", () => {
    expect(matchPerson("", families)).toEqual({
      familyId: null,
      personId: null,
    })
  })

  it("does not match when last name is only a prefix of the next word", () => {
    // "SMITHSON" starts with "SMITH" — must not match John Smith
    expect(matchPerson("PAYMENT FROM JOHN SMITHSON", families)).toEqual({
      familyId: null,
      personId: null,
    })
  })

  it("matches when name appears at end of string with no trailing chars", () => {
    expect(matchPerson("TITHE FROM JOHN SMITH", families)).toEqual({
      familyId: 1,
      personId: 10,
    })
  })
})

const familiesWithAliases = [
  {
    id: 1,
    name: "Smith",
    people: [
      { id: 10, firstName: "Jonathan", lastName: "Smith", bankingName: "JON SMITH" },
      { id: 11, firstName: "Mary", lastName: "Smith", bankingName: null },
    ],
  },
  {
    id: 2,
    name: "Jones",
    people: [
      { id: 20, firstName: "Alice", lastName: "Jones", bankingName: "ALICE MARGARET JONES" },
    ],
  },
]

describe("matchPerson — bankingName alias (pass 2)", () => {
  it("matches by bankingName when full name not present", () => {
    expect(matchPerson("PAYMENT JON SMITH REF123", familiesWithAliases)).toEqual({
      familyId: 1,
      personId: 10,
    })
  })

  it("bankingName match is case-insensitive", () => {
    expect(matchPerson("payment jon smith ref123", familiesWithAliases)).toEqual({
      familyId: 1,
      personId: 10,
    })
  })

  it("full name match takes priority over bankingName match from another person", () => {
    expect(
      matchPerson("JONATHAN SMITH ALICE MARGARET JONES", familiesWithAliases)
    ).toEqual({ familyId: 1, personId: 10 })
  })

  it("bankingName word-boundary enforced", () => {
    expect(matchPerson("PAYMENT JONSMITH", familiesWithAliases)).toEqual({
      familyId: null,
      personId: null,
    })
  })

  it("null bankingName is skipped in pass 2", () => {
    expect(matchPerson("MARY SMITHSON DONATION", familiesWithAliases)).toEqual({
      familyId: null,
      personId: null,
    })
  })

  it("matches bankingName with middle name included", () => {
    expect(matchPerson("TFR ALICE MARGARET JONES REF99", familiesWithAliases)).toEqual({
      familyId: 2,
      personId: 20,
    })
  })

  it("returns null/null when bankingName in text is prefix of a longer word", () => {
    expect(matchPerson("PAYMENT JON SMITHSON", familiesWithAliases)).toEqual({
      familyId: null,
      personId: null,
    })
  })

  it("does not auto-match a too-short bankingName alias inside an unrelated payee", () => {
    const familiesShortAlias = [
      {
        id: 3,
        name: "Kg",
        people: [{ id: 30, firstName: "Kevin", lastName: "Green", bankingName: "K G" }],
      },
    ]
    // "K G" would sit at real word boundaries inside "K G HARDWARE", but a 3-char
    // alias is too collision-prone to auto-attribute a payment.
    expect(matchPerson("EFTPOS K G HARDWARE STORE", familiesShortAlias)).toEqual({
      familyId: null,
      personId: null,
    })
  })

  it("still auto-matches a bankingName alias at/above the minimum length", () => {
    const familiesOkAlias = [
      {
        id: 4,
        name: "Green",
        people: [{ id: 40, firstName: "Kevin", lastName: "Green", bankingName: "KEVG" }],
      },
    ]
    expect(matchPerson("PAYMENT FROM KEVG REF 12", familiesOkAlias)).toEqual({
      familyId: 4,
      personId: 40,
    })
  })
})

function makeReviewRow(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    date: "2026-05-01",
    description: "PAYMENT",
    details: "",
    amount: "100.00",
    type: "INCOME",
    bankRef: `ANZ_${Math.random()}`,
    dedupKey: "",
    accountId: null,
    skip: false,
    isDuplicate: false,
    familyId: null,
    personId: null,
    fromPettyCash: false,
    ...overrides,
  }
}

describe("applyCategoryToRows", () => {
  const incomeAccount = { id: 7, code: "4001", name: "Tithes", type: "INCOME" as const }
  const expenseAccount = { id: 8, code: "5001", name: "Maintenance", type: "EXPENSE" as const }

  it("sets accountId only on rows matching the account type", () => {
    const rows = [
      makeReviewRow({ type: "INCOME" }),
      makeReviewRow({ type: "EXPENSE" }),
      makeReviewRow({ type: "INCOME" }),
    ]
    const result = applyCategoryToRows(rows, incomeAccount)
    expect(result.map((r) => r.accountId)).toEqual([7, null, 7])
  })

  it("leaves an existing selection on type-mismatched rows untouched", () => {
    const rows = [makeReviewRow({ type: "EXPENSE", accountId: 8 })]
    const result = applyCategoryToRows(rows, incomeAccount)
    expect(result[0].accountId).toBe(8)
  })

  it("applies expense account only to expense rows", () => {
    const rows = [makeReviewRow({ type: "INCOME", accountId: 7 }), makeReviewRow({ type: "EXPENSE" })]
    const result = applyCategoryToRows(rows, expenseAccount)
    expect(result.map((r) => r.accountId)).toEqual([7, 8])
  })
})
