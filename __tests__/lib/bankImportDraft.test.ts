/**
 * @jest-environment jsdom
 */
import {
  saveDraft,
  loadDraft,
  clearDraft,
  markImported,
  draftFingerprint,
  mergeDraftSelections,
  clearMismatchedAccountIds,
  type BankImportDraft,
} from "@/lib/bankImportDraft"
import type { ReviewRow } from "@/lib/bankTypes"

function makeRow(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    date: "2026-05-01",
    description: "PAYMENT",
    details: "",
    amount: "100.00",
    type: "INCOME",
    bankRef: "ANZ_1",
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

function makeDraft(overrides: Partial<BankImportDraft> = {}): BankImportDraft {
  return {
    rows: [makeRow()],
    period: { from: "2026-05-01", to: "2026-05-31" },
    paymentAccountId: 1,
    ...overrides,
  }
}

beforeEach(() => {
  sessionStorage.clear()
})

describe("saveDraft / loadDraft / clearDraft", () => {
  it("round-trips a draft through sessionStorage", () => {
    const draft = makeDraft()
    saveDraft(draft)
    expect(loadDraft()).toEqual(draft)
  })

  it("returns null when no draft saved", () => {
    expect(loadDraft()).toBeNull()
  })

  it("returns null for corrupt JSON", () => {
    sessionStorage.setItem("bankImportDraft.v1", "{not json")
    expect(loadDraft()).toBeNull()
  })

  it("returns null when rows is missing or empty", () => {
    sessionStorage.setItem("bankImportDraft.v1", JSON.stringify({ rows: [], period: null, paymentAccountId: "" }))
    expect(loadDraft()).toBeNull()
    sessionStorage.setItem("bankImportDraft.v1", JSON.stringify({ period: null }))
    expect(loadDraft()).toBeNull()
  })

  it("clearDraft removes the saved draft", () => {
    saveDraft(makeDraft())
    clearDraft()
    expect(loadDraft()).toBeNull()
  })

  it("markImported clears a draft whose content still matches the imported fingerprint", () => {
    const draft = makeDraft()
    saveDraft(draft)
    markImported(draftFingerprint(draft))
    expect(loadDraft()).toBeNull()
  })

  it("markImported leaves a draft the operator edited after navigating away", () => {
    const submitted = draftFingerprint(makeDraft())
    // Operator returned and edited the review before the import resolved.
    saveDraft(makeDraft({ rows: [makeRow({ bankRef: "EDITED" })] }))
    markImported(submitted)
    expect(loadDraft()?.rows[0].bankRef).toBe("EDITED")
  })

  it("tombstone: loadDraft skips an imported draft re-written after clear", () => {
    const draft = makeDraft()
    markImported(draftFingerprint(draft))
    // A late remount persistence effect writes the identical draft back...
    sessionStorage.setItem("bankImportDraft.v1", draftFingerprint(draft))
    // ...but loadDraft treats already-imported content as absent.
    expect(loadDraft()).toBeNull()
  })

  it("tombstone: saveDraft refuses to persist already-imported content", () => {
    const draft = makeDraft()
    markImported(draftFingerprint(draft))
    saveDraft(draft) // late remount persistence attempt
    expect(sessionStorage.getItem("bankImportDraft.v1")).toBeNull()
  })

  it("tombstone: a different (edited) draft still persists and restores after an import", () => {
    markImported(draftFingerprint(makeDraft()))
    const edited = makeDraft({ rows: [makeRow({ bankRef: "EDITED" })] })
    saveDraft(edited)
    expect(loadDraft()?.rows[0].bankRef).toBe("EDITED")
  })

  it("tombstone: retains earlier imports so overlapping confirmations don't evict one another (round-5 codex)", () => {
    const a = makeDraft({ rows: [makeRow({ bankRef: "A" })] })
    const b = makeDraft({ rows: [makeRow({ bankRef: "B" })] })
    // Two confirmations in flight; B resolves, then A resolves.
    markImported(draftFingerprint(b))
    markImported(draftFingerprint(a))
    // A late remount persistence effect for B must still be refused...
    saveDraft(b)
    expect(loadDraft()).toBeNull()
    // ...and A stays tombstoned too.
    saveDraft(a)
    expect(loadDraft()).toBeNull()
  })

  it("tombstone: suppresses a draft whose category was normalized on restore after import (round-6 codex)", () => {
    // Operator submitted the review with a category selected.
    const submitted = draftFingerprint(makeDraft({ rows: [makeRow({ accountId: 5 })] }))
    markImported(submitted)
    // On revisit that account had been deactivated, so restore cleared its id
    // before persisting the normalized copy — a different literal serialization.
    saveDraft(makeDraft({ rows: [makeRow({ accountId: null })] }))
    expect(loadDraft()).toBeNull()
  })

  it("tombstone: markImported clears a live draft normalized on restore (round-6 codex)", () => {
    const submitted = draftFingerprint(makeDraft({ rows: [makeRow({ accountId: 5 })] }))
    // The normalized copy is what actually sits in storage when the delayed
    // success response lands.
    saveDraft(makeDraft({ rows: [makeRow({ accountId: null })] }))
    markImported(submitted)
    expect(sessionStorage.getItem("bankImportDraft.v1")).toBeNull()
  })

  it("tombstone: still drops the live draft when the tombstone write fails under quota (round-5 codex)", () => {
    const draft = makeDraft()
    saveDraft(draft)
    const real = Storage.prototype.setItem
    const spy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === "bankImportDraft.imported.v2") throw new DOMException("quota", "QuotaExceededError")
        return real.call(this, key, value)
      })
    try {
      markImported(draftFingerprint(draft))
    } finally {
      spy.mockRestore()
    }
    // Cleanup of the imported draft landed despite the tombstone write throwing.
    expect(sessionStorage.getItem("bankImportDraft.v1")).toBeNull()
  })

  it("returns null when a row has a wrong-typed field", () => {
    const bad = makeDraft()
    ;(bad.rows[0] as unknown as { amount: number }).amount = 100
    sessionStorage.setItem("bankImportDraft.v1", JSON.stringify(bad))
    expect(loadDraft()).toBeNull()
  })

  it("returns null when a row has an invalid type value", () => {
    const bad = makeDraft()
    ;(bad.rows[0] as unknown as { type: string }).type = "TRANSFER"
    sessionStorage.setItem("bankImportDraft.v1", JSON.stringify(bad))
    expect(loadDraft()).toBeNull()
  })

  it("returns null when a row is not an object", () => {
    sessionStorage.setItem(
      "bankImportDraft.v1",
      JSON.stringify({ rows: ["nope"], period: null, paymentAccountId: "" })
    )
    expect(loadDraft()).toBeNull()
  })

  it("returns null for an invalid paymentAccountId value", () => {
    const bad = makeDraft({ paymentAccountId: "EVIL" as unknown as BankImportDraft["paymentAccountId"] })
    sessionStorage.setItem("bankImportDraft.v1", JSON.stringify(bad))
    expect(loadDraft()).toBeNull()
  })

  it("accepts a draft with null period and empty paymentAccountId", () => {
    const draft = makeDraft({ period: null, paymentAccountId: "" })
    saveDraft(draft)
    expect(loadDraft()).toEqual(draft)
  })

  it("accepts nullable ids set to numbers", () => {
    const draft = makeDraft({ rows: [makeRow({ accountId: 5, familyId: 2, personId: 9 })] })
    saveDraft(draft)
    expect(loadDraft()).toEqual(draft)
  })

  it("round-trips a row with a valid splits array", () => {
    const draft = makeDraft({
      rows: [makeRow({ splits: [
        { accountId: 1, amount: "60.00", familyId: 2, personId: 9 },
        { accountId: 3, amount: "40.00", familyId: null, personId: null },
      ] })],
    })
    saveDraft(draft)
    expect(loadDraft()).toEqual(draft)
  })

  it("returns null when a split line is malformed", () => {
    const bad = makeDraft({ rows: [makeRow()] })
    ;(bad.rows[0] as unknown as { splits: unknown }).splits = [{ accountId: 1, amount: 60 }]
    sessionStorage.setItem("bankImportDraft.v1", JSON.stringify(bad))
    expect(loadDraft()).toBeNull()
  })
})

describe("clearMismatchedAccountIds", () => {
  const accounts = [
    { id: 1, code: "4001", name: "Tithes", type: "INCOME" as const },
    { id: 2, code: "5001", name: "Utilities", type: "EXPENSE" as const },
  ]

  it("clears accountId when the account's type no longer matches the row type", () => {
    const rows = [makeRow({ type: "INCOME", accountId: 2 })]
    const out = clearMismatchedAccountIds(rows, accounts)
    expect(out[0].accountId).toBeNull()
  })

  it("clears accountId when the account no longer exists", () => {
    const rows = [makeRow({ accountId: 99 })]
    const out = clearMismatchedAccountIds(rows, accounts)
    expect(out[0].accountId).toBeNull()
  })

  it("keeps a type-matching accountId and null accountIds", () => {
    const rows = [makeRow({ type: "INCOME", accountId: 1 }), makeRow({ accountId: null })]
    const out = clearMismatchedAccountIds(rows, accounts)
    expect(out[0].accountId).toBe(1)
    expect(out[1].accountId).toBeNull()
  })

  it("clears a split line's accountId when its account type no longer matches the row type", () => {
    const rows = [makeRow({ type: "INCOME", splits: [
      { accountId: 1, amount: "60.00", familyId: null, personId: null },
      { accountId: 2, amount: "40.00", familyId: null, personId: null },
    ] })]
    const out = clearMismatchedAccountIds(rows, accounts)
    expect(out[0].splits?.[0].accountId).toBe(1)
    expect(out[0].splits?.[1].accountId).toBeNull()
  })
})

describe("mergeDraftSelections", () => {
  it("copies selections onto freshly parsed rows by bankRef", () => {
    const prev = [
      makeRow({ bankRef: "ANZ_1", accountId: 7, familyId: 1, personId: 10, skip: false, fromPettyCash: false }),
      makeRow({ bankRef: "ANZ_2", accountId: 8, skip: true }),
    ]
    const fresh = [
      makeRow({ bankRef: "ANZ_1", accountId: null }),
      makeRow({ bankRef: "ANZ_2", accountId: null, skip: false }),
    ]
    const merged = mergeDraftSelections(fresh, prev)
    expect(merged[0]).toMatchObject({ accountId: 7, familyId: 1, personId: 10 })
    expect(merged[1]).toMatchObject({ accountId: 8, skip: true })
  })

  it("leaves rows without a matching bankRef untouched", () => {
    const prev = [makeRow({ bankRef: "ANZ_OLD", accountId: 7 })]
    const fresh = [makeRow({ bankRef: "ANZ_NEW", accountId: null, personId: 99 })]
    const merged = mergeDraftSelections(fresh, prev)
    expect(merged[0]).toMatchObject({ bankRef: "ANZ_NEW", accountId: null, personId: 99 })
  })

  it("keeps parsed fields from the fresh row, selections from the previous row", () => {
    const prev = [makeRow({ bankRef: "ANZ_1", accountId: 7, description: "OLD DESC" })]
    const fresh = [makeRow({ bankRef: "ANZ_1", description: "NEW DESC", isDuplicate: true })]
    const merged = mergeDraftSelections(fresh, prev)
    expect(merged[0]).toMatchObject({ description: "NEW DESC", isDuplicate: true, accountId: 7 })
  })

  it("returns fresh rows unchanged when previous rows empty", () => {
    const fresh = [makeRow()]
    expect(mergeDraftSelections(fresh, [])).toEqual(fresh)
  })

  it("carries the previous row's splits onto the fresh row", () => {
    const splits = [
      { accountId: 7, amount: "60.00", familyId: 1, personId: 10 },
      { accountId: 8, amount: "40.00", familyId: null, personId: null },
    ]
    const prev = [makeRow({ bankRef: "ANZ_1", splits })]
    const fresh = [makeRow({ bankRef: "ANZ_1" })]
    const merged = mergeDraftSelections(fresh, prev)
    expect(merged[0].splits).toEqual(splits)
  })

  it("keeps auto-skip on rows the new upload flags as duplicates", () => {
    // previously not a duplicate (skip=false); now flagged duplicate by re-upload
    const prev = [makeRow({ bankRef: "ANZ_1", skip: false, accountId: 7 })]
    const fresh = [makeRow({ bankRef: "ANZ_1", isDuplicate: true, skip: true })]
    const merged = mergeDraftSelections(fresh, prev)
    expect(merged[0]).toMatchObject({ skip: true, isDuplicate: true, accountId: 7 })
  })
})
