/** @jest-environment node */
// each batch of re-encryptions must commit in ONE $transaction, never per-row.

const KEY1 = Buffer.alloc(32, 7).toString("base64")
const KEY2 = Buffer.alloc(32, 9).toString("base64")

function setBaseEnv() {
  process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db" // never connected to — delegate is injected
  process.env.ENCRYPTION_KEY_V1 = KEY1
  process.env.ENCRYPTION_KEY_V2 = KEY2
}

// $transaction stand-in: every conditional updateMany matched exactly one row.
const okTx = async (ops: unknown[]) => ops.map(() => ({ count: 1 }))

afterEach(() => {
  jest.resetModules()
  for (const k of ["DATABASE_URL", "ENCRYPTION_KEY", "ENCRYPTION_KEY_V1", "ENCRYPTION_KEY_V2", "ENCRYPTION_KEY_ID"]) {
    delete process.env[k]
  }
})

it("commits a non-empty batch in a single transaction, not per-row", async () => {
  setBaseEnv()
  // Build two real v1-encrypted values while v1 is current.
  process.env.ENCRYPTION_KEY_ID = "v1"
  const { encrypt: enc } = await import("@/lib/cryptoCore")
  const v1a = enc("secret-a")
  const v1b = enc("secret-b")

  // Reload script with v2 as the current key id so rotateRow re-encrypts v1 -> v2.
  jest.resetModules()
  process.env.ENCRYPTION_KEY_ID = "v2"
  const { rotateModel } = await import("../../scripts/rotate-encryption-key")

  const update = jest.fn((arg: unknown) => ({ __op: arg })) // PrismaPromise stand-in
  const runTx = jest.fn(okTx)
  const delegate = {
    count: jest.fn().mockResolvedValue(2),
    findMany: jest.fn().mockResolvedValueOnce([
      { id: 1, description: v1a },
      { id: 2, description: v1b },
    ]),
    updateMany: update,
  }

  await rotateModel("transaction", { delegate, runTx, apply: true })

  expect(runTx).toHaveBeenCalledTimes(1)
  expect(runTx.mock.calls[0][0]).toHaveLength(2)
  expect(update).toHaveBeenCalledTimes(2)
})

it("does not write in dry-run (apply: false)", async () => {
  setBaseEnv()
  process.env.ENCRYPTION_KEY_ID = "v1"
  const { encrypt: enc } = await import("@/lib/cryptoCore")
  const v1a = enc("x")
  jest.resetModules()
  process.env.ENCRYPTION_KEY_ID = "v2"
  const { rotateModel } = await import("../../scripts/rotate-encryption-key")

  const runTx = jest.fn()
  const delegate = {
    count: jest.fn().mockResolvedValue(1),
    findMany: jest.fn().mockResolvedValueOnce([{ id: 1, description: v1a }]),
    updateMany: jest.fn(),
  }
  await rotateModel("transaction", { delegate, runTx, apply: false })
  expect(runTx).not.toHaveBeenCalled()
})

it("skips rows already on the current key and non-string values", async () => {
  setBaseEnv()
  // Encrypt one value under the CURRENT key (v2) — must NOT be re-encrypted.
  process.env.ENCRYPTION_KEY_ID = "v2"
  const { encrypt: enc } = await import("@/lib/cryptoCore")
  const v2current = enc("already-current")
  jest.resetModules()
  process.env.ENCRYPTION_KEY_ID = "v2"
  const { rotateModel } = await import("../../scripts/rotate-encryption-key")

  const runTx = jest.fn(okTx)
  const delegate = {
    count: jest.fn().mockResolvedValue(3),
    findMany: jest.fn().mockResolvedValueOnce([
      { id: 1, description: v2current }, // current key → skip
      { id: 2, description: null }, // non-string → skip
      { id: 3, description: "plaintext-never-encrypted" }, // no key id → skip
    ]),
    updateMany: jest.fn((arg: unknown) => ({ __op: arg })),
  }
  await rotateModel("transaction", { delegate, runTx, apply: true })
  // Nothing to rotate → no transaction, no update.
  expect(runTx).not.toHaveBeenCalled()
  expect(delegate.updateMany).not.toHaveBeenCalled()
})

it("re-keys a BYTEA blob column (transactionAttachment.data)", async () => {
  setBaseEnv()
  // The attachment blob is `Buffer.from(encrypt(base64), "utf8")` — an encrypted
  // string stored as bytes. Build one under v1, then rotate to v2.
  process.env.ENCRYPTION_KEY_ID = "v1"
  const { encrypt: enc } = await import("@/lib/cryptoCore")
  const plainB64 = Buffer.from("receipt-bytes").toString("base64")
  const v1blob = Buffer.from(enc(plainB64), "utf8")
  const v1name = enc("receipt.pdf")

  jest.resetModules()
  process.env.ENCRYPTION_KEY_ID = "v2"
  const { rotateModel } = await import("../../scripts/rotate-encryption-key")
  const { decrypt, keyIdOf } = await import("@/lib/cryptoCore")

  const update = jest.fn((arg: unknown) => ({ __op: arg }))
  const runTx = jest.fn(okTx)
  const delegate = {
    count: jest.fn().mockResolvedValue(1),
    findMany: jest.fn().mockResolvedValueOnce([{ id: 1, filename: v1name, data: v1blob }]),
    updateMany: update,
  }
  await rotateModel("transactionAttachment", { delegate, runTx, apply: true })

  expect(update).toHaveBeenCalledTimes(1)
  const data = (update.mock.calls[0][0] as { data: { data: Buffer; filename: string } }).data
  // Blob written back as a Buffer, re-keyed to v2, decrypting to the same bytes.
  expect(Buffer.isBuffer(data.data)).toBe(true)
  expect(keyIdOf(data.data.toString("utf8"))).toBe("v2")
  expect(decrypt(data.data.toString("utf8"))).toBe(plainB64)
  // Sibling string column still rotates too.
  expect(keyIdOf(data.filename)).toBe("v2")
})

it("re-keys a blob returned as a plain Uint8Array (not a Buffer)", async () => {
  setBaseEnv()
  process.env.ENCRYPTION_KEY_ID = "v1"
  const { encrypt: enc } = await import("@/lib/cryptoCore")
  const plainB64 = Buffer.from("clearance-bytes").toString("base64")
  const v1blob = new Uint8Array(Buffer.from(enc(plainB64), "utf8"))
  expect(Buffer.isBuffer(v1blob)).toBe(false)

  jest.resetModules()
  process.env.ENCRYPTION_KEY_ID = "v2"
  const { rotateModel } = await import("../../scripts/rotate-encryption-key")
  const { decrypt, keyIdOf } = await import("@/lib/cryptoCore")

  const update = jest.fn((arg: unknown) => ({ __op: arg }))
  const delegate = {
    count: jest.fn().mockResolvedValue(1),
    findMany: jest.fn().mockResolvedValueOnce([{ id: "c1", document: v1blob }]).mockResolvedValue([]),
    updateMany: update,
  }
  await rotateModel("personClearance", { delegate, runTx: jest.fn(okTx), apply: true })

  expect(update).toHaveBeenCalledTimes(1)
  const data = (update.mock.calls[0][0] as { data: { document: Buffer } }).data
  expect(Buffer.isBuffer(data.document)).toBe(true)
  expect(keyIdOf(data.document.toString("utf8"))).toBe("v2")
  expect(decrypt(data.document.toString("utf8"))).toBe(plainB64)
})

// a single malformed/undecryptable ciphertext row must not abort the
// whole rotation — the previous behaviour propagated decrypt()'s throw out of
// the model loop, aborting every model that hadn't run yet.
describe("resilience to a malformed ciphertext row", () => {
  it("skips a bad row, keeps rotating the rest of the batch, and reports it via badRows", async () => {
    setBaseEnv()
    process.env.ENCRYPTION_KEY_ID = "v1"
    const { encrypt: enc } = await import("@/lib/cryptoCore")
    const good1 = enc("secret-a")
    const good2 = enc("secret-b")
    // A row with a well-formed (valid base64, right byte shape) ciphertext
    // whose auth tag belongs to a DIFFERENT value — keyIdOf still reports
    // "v1" (it's a well-formed candidate), so rotateRow calls decrypt(),
    // which throws on the GCM auth-tag mismatch — simulating real bit-rot /
    // corruption rather than a hand-typed malformed string.
    const other = enc("mismatched-tag-source")
    const partsGood = good1.split(":")
    const partsOther = other.split(":")
    const badRow = [partsGood[0], partsGood[1], partsGood[2], partsOther[3], partsGood[4]].join(":")
    jest.resetModules()
    process.env.ENCRYPTION_KEY_ID = "v2"
    const { rotateModel } = await import("../../scripts/rotate-encryption-key")

    const update = jest.fn((arg: unknown) => ({ __op: arg }))
    const runTx = jest.fn(okTx)
    const delegate = {
      count: jest.fn().mockResolvedValue(3),
      findMany: jest.fn().mockResolvedValueOnce([
        { id: 1, description: good1 },
        { id: 2, description: badRow },
        { id: 3, description: good2 },
      ]),
      updateMany: update,
    }

    const result = await rotateModel("transaction", { delegate, runTx, apply: true })

    // Both good rows still rotated — the bad row in between didn't abort the batch.
    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls.map((c) => (c[0] as { where: { id: number } }).where.id)).toEqual([1, 3])
    expect(result).toEqual({ changed: 2, badRows: 1, conflicts: 0 })
  })

  // reviewer: the base64 hardening must NOT downgrade a
  // versioned-but-corrupt ciphertext to plaintext — that would silently hide
  // the exact bad-row class exists to surface. A row with the v<n>
  // marker but a non-base64 (bit-flipped-out-of-alphabet) payload must still
  // reach decrypt(), throw, and be counted as a bad row — not skipped as
  // "nothing to rotate".
  it("counts a versioned ciphertext with a corrupt (non-base64) payload as a bad row", async () => {
    setBaseEnv()
    process.env.ENCRYPTION_KEY_ID = "v1"
    const { encrypt: enc } = await import("@/lib/cryptoCore")
    const good = enc("secret-a")
    // v<n> marker present (keyIdOf → "v1", so it's treated as ours and reaches
    // decrypt), but the ciphertext segment contains a char outside the base64
    // alphabet AND won't decrypt — decrypt() throws → bad row. Under the old
    // over-aggressive sniff this whole value was misread as plaintext and
    // silently skipped (badRows stayed 0), which is the regression being pinned.
    const corrupt = "enc:v1:aXY=:dGFn:corrupt!payload with spaces"
    jest.resetModules()
    process.env.ENCRYPTION_KEY_ID = "v2"
    const { rotateModel } = await import("../../scripts/rotate-encryption-key")

    const update = jest.fn((arg: unknown) => ({ __op: arg }))
    const runTx = jest.fn(okTx)
    const delegate = {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValueOnce([
        { id: 1, description: good },
        { id: 2, description: corrupt },
      ]),
      updateMany: update,
    }

    const result = await rotateModel("transaction", { delegate, runTx, apply: true })

    // Good row rotated; corrupt versioned row NOT silently skipped — counted bad.
    expect(update).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ changed: 1, badRows: 1, conflicts: 0 })
  })

  it("keeps processing later models after an earlier model hits a bad row", async () => {
    setBaseEnv()
    process.env.ENCRYPTION_KEY_ID = "v1"
    const { encrypt: enc } = await import("@/lib/cryptoCore")
    const good = enc("still-rotates")
    const forNotes = enc("family-notes-source")
    const other = enc("mismatched-tag-source-2")
    const partsGood = forNotes.split(":")
    const partsOther = other.split(":")
    const badRow = [partsGood[0], partsGood[1], partsGood[2], partsOther[3], partsGood[4]].join(":")
    jest.resetModules()
    process.env.ENCRYPTION_KEY_ID = "v2"
    const { rotateModel } = await import("../../scripts/rotate-encryption-key")

    // Model 1 ("family") has only the bad row — rotateModel must return, not throw.
    const familyDelegate = {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValueOnce([{ id: 1, notes: badRow }]),
      updateMany: jest.fn(),
    }
    const familyResult = await rotateModel("family", { delegate: familyDelegate, apply: true })
    expect(familyResult).toEqual({ changed: 0, badRows: 1, conflicts: 0 })

    // A later model in the same run still rotates normally — the earlier
    // model's bad row didn't abort anything above rotateModel either.
    const txUpdate = jest.fn((arg: unknown) => ({ __op: arg }))
    const txDelegate = {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValueOnce([{ id: 1, description: good }]),
      updateMany: txUpdate,
    }
    const txResult = await rotateModel("transaction", {
      delegate: txDelegate,
      runTx: jest.fn(okTx),
      apply: true,
    })
    expect(txResult).toEqual({ changed: 1, badRows: 0, conflicts: 0 })
    expect(txUpdate).toHaveBeenCalledTimes(1)
  })
})

// #166: a user edit landing between the batch read and the write must never be
// overwritten with a re-encrypted copy of the stale value.
describe("concurrent edits between read and write", () => {
  async function setup() {
    setBaseEnv()
    process.env.ENCRYPTION_KEY_ID = "v1"
    const { encrypt: enc } = await import("@/lib/cryptoCore")
    const stale = enc("old-number")
    const userEdit = enc("new-number") // user saves while rotation is mid-batch
    jest.resetModules()
    process.env.ENCRYPTION_KEY_ID = "v2"
    const mod = await import("../../scripts/rotate-encryption-key")
    const crypto = await import("@/lib/cryptoCore")
    return { ...mod, ...crypto, stale, userEdit }
  }

  it("writes conditionally on the ciphertext that was read", async () => {
    const { rotateModel, stale } = await setup()
    const updateMany = jest.fn((arg: unknown) => ({ __op: arg }))
    const delegate = {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValueOnce([{ id: "c1", number: stale }]),
      updateMany,
    }
    await rotateModel("personClearance", { delegate, runTx: jest.fn(okTx), apply: true })
    expect(updateMany).toHaveBeenCalledTimes(1)
    const { where } = updateMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(where).toEqual({ id: "c1", number: { equals: stale } })
  })

  it("re-reads and re-keys the fresh value when the row changed, never the stale one", async () => {
    const { rotateModel, stale, userEdit, decrypt, keyIdOf } = await setup()
    const updateMany = jest.fn((arg: unknown) => ({ __op: arg }))
    const delegate = {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: "c1", number: stale }]) // batch read
        .mockResolvedValueOnce([{ id: "c1", number: userEdit }]), // re-read after conflict
      updateMany,
    }
    // Batch write misses (row changed underneath); the single-row retry matches.
    const runTx = jest
      .fn()
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 1 }])

    const result = await rotateModel("personClearance", { delegate, runTx, apply: true })

    expect(result).toEqual({ changed: 1, badRows: 0, conflicts: 0 })
    const retry = updateMany.mock.calls[1][0] as { where: Record<string, unknown>; data: { number: string } }
    expect(retry.where).toEqual({ id: "c1", number: { equals: userEdit } })
    expect(keyIdOf(retry.data.number)).toBe("v2")
    expect(decrypt(retry.data.number)).toBe("new-number")
  })

  it("treats a row the user already re-saved on the current key as resolved", async () => {
    const { rotateModel, stale, encrypt } = await setup()
    const delegate = {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: "c1", number: stale }])
        .mockResolvedValueOnce([{ id: "c1", number: encrypt("saved-on-v2") }]),
      updateMany: jest.fn((arg: unknown) => ({ __op: arg })),
    }
    const runTx = jest.fn().mockResolvedValueOnce([{ count: 0 }])
    const result = await rotateModel("personClearance", { delegate, runTx, apply: true })
    expect(result).toEqual({ changed: 0, badRows: 0, conflicts: 0 })
    expect(runTx).toHaveBeenCalledTimes(1)
  })

  it("reports a row that keeps changing as a conflict after the retry limit", async () => {
    const { rotateModel, stale } = await setup()
    const delegate = {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([{ id: "c1", number: stale }]),
      updateMany: jest.fn((arg: unknown) => ({ __op: arg })),
    }
    const runTx = jest.fn().mockResolvedValue([{ count: 0 }]) // every write misses
    const result = await rotateModel("personClearance", { delegate, runTx, apply: true })
    expect(result).toEqual({ changed: 0, badRows: 0, conflicts: 1 })
    // Pin the retry limit: 1 batch read + 3 re-reads, 1 batch write + 3 retries.
    expect(delegate.findMany).toHaveBeenCalledTimes(4)
    expect(delegate.updateMany).toHaveBeenCalledTimes(4)
    expect(runTx).toHaveBeenCalledTimes(4)
  })
})

describe("FIELDS map", () => {
  // Canonical set of encrypted columns — mirrors the FIELDS inventory in scripts/rotate-encryption-key.ts.
  // Changing FIELDS without updating this list (or vice-versa) fails CI, so a
  // newly-encrypted column can never be silently omitted from key rotation.
  const CANONICAL: Record<string, string[]> = {
    family: ["address", "suburb", "state", "postcode", "homePhone", "notes"],
    // notes added: Person.notes is now encrypted on write, same as
    // Family.notes — previously it rode through unencrypted entirely.
    person: [
      "email", "dateOfBirth", "mobile", "workPhone", "homePhone", "notes",
      "pastoralNotes", "emergencyContactName", "emergencyContactPhone",
    ],
    // notes added: encrypted at write in bankImportConfirm.ts and the
    // manual transaction action; historical plaintext backfilled separately.
    transaction: ["description", "notes"],
    receiptSend: ["sentTo"],
    // PaymentReminderSend mirrors ReceiptSend: sentTo (recipient email) is PII.
    paymentReminderSend: ["sentTo"],
    registration: ["email", "phone"],
    pettyCashExpense: ["payee", "description"],
    pettyCashReceipt: ["notes"],
    pettyCashTransfer: ["depositedByName", "notes"],
    familyUpdateSubmission: ["payload"],
    // MembershipApplication was omitted entirely; written encrypted at
    // src/lib/actions/membership.ts (submitMembershipApplication).
    membershipApplication: ["payload", "signature", "email", "mobile"],
    // two more orphans the coverage guard surfaced — donorEmail
    // (dgrReceipt.ts) and filename (transactionAttachment.ts). The attachment
    // blob column `data` (BYTEA) is now re-keyed via the blob path and
    // listed in BLOB_FIELDS, so it belongs here too.
    dgrReceipt: ["donorEmail"],
    transactionAttachment: ["filename", "data"],
    // TOTP authenticator secrets (src/lib/actions/totp.ts).
    user: ["totpSecret", "totpPendingSecret"],
    // Child-safety clearances (src/lib/actions/clearance.ts): number, filename,
    // verification note are strings; `document` is the BYTEA blob (BLOB_FIELDS).
    personClearance: ["number", "documentName", "document", "verificationNote"],
  }
  // Registration.customAnswers is appended separately below (kept out of the
  // literal above so the intent — "registration gained a field" — stays visible
  // at the assertion site).
  CANONICAL.registration = ["email", "phone", "customAnswers"]

  it("matches the canonical encrypted-field set exactly", async () => {
    setBaseEnv()
    const { FIELDS } = await import("../../scripts/rotate-encryption-key")
    expect(FIELDS).toEqual(CANONICAL)
  })

  // targeted regression — the two orphaned encrypted columns that would
  // silently stay on the old key forever once it's retired.
  it("includes MembershipApplication's 4 encrypted fields", async () => {
    setBaseEnv()
    const { FIELDS } = await import("../../scripts/rotate-encryption-key")
    expect(Object.keys(FIELDS)).toContain("membershipApplication")
    expect(FIELDS.membershipApplication).toEqual(
      expect.arrayContaining(["payload", "signature", "email", "mobile"])
    )
  })

  it("includes Registration.customAnswers alongside email/phone", async () => {
    setBaseEnv()
    const { FIELDS } = await import("../../scripts/rotate-encryption-key")
    expect(FIELDS.registration).toContain("customAnswers")
  })

  it("only names real Prisma models (every key is a valid delegate)", async () => {
    setBaseEnv()
    const { FIELDS } = await import("../../scripts/rotate-encryption-key")
    const { Prisma } = await import("@/lib/generated/prisma/client")
    // FIELDS keys are camelCase delegate names; ModelName values are PascalCase.
    const delegates = new Set(
      Object.values(Prisma.ModelName).map((m) => m[0].toLowerCase() + m.slice(1))
    )
    for (const name of Object.keys(FIELDS)) {
      expect(delegates.has(name)).toBe(true)
    }
  })
})

// Rotation is documented as safe with the app running, so rows can be deleted
// mid-run. OFFSET paging + a loop bounded by the up-front count would then
// either skip a row (left on the old key) or never terminate.
describe("pagination under concurrent deletes", () => {
  it("pages by id (keyset), not OFFSET, so a delete can't shift a row out of view", async () => {
    setBaseEnv()
    process.env.ENCRYPTION_KEY_ID = "v1"
    const { encrypt: enc } = await import("@/lib/cryptoCore")
    const v1 = enc("x")
    jest.resetModules()
    process.env.ENCRYPTION_KEY_ID = "v2"
    const { rotateModel } = await import("../../scripts/rotate-encryption-key")

    const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, description: v1 }))
    const findMany = jest.fn().mockResolvedValueOnce(fullPage).mockResolvedValueOnce([{ id: 102, description: v1 }])
    const delegate = { count: jest.fn().mockResolvedValue(101), findMany, updateMany: jest.fn((a: unknown) => a) }

    const { changed } = await rotateModel("transaction", { delegate, runTx: okTx, apply: true })

    expect(findMany.mock.calls[0][0]).not.toHaveProperty("skip")
    expect(findMany.mock.calls[1][0]).toMatchObject({ where: { id: { gt: 100 } } })
    expect(findMany.mock.calls[1][0]).not.toHaveProperty("skip")
    expect(changed).toBe(101)
  })

  it("terminates when rows were deleted after the count (empty page)", async () => {
    setBaseEnv()
    process.env.ENCRYPTION_KEY_ID = "v1"
    const { encrypt: enc } = await import("@/lib/cryptoCore")
    const v1 = enc("x")
    jest.resetModules()
    process.env.ENCRYPTION_KEY_ID = "v2"
    const { rotateModel } = await import("../../scripts/rotate-encryption-key")

    const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, description: v1 }))
    // count said 101, but the 101st row was deleted before page 2 was read.
    const findMany = jest.fn().mockResolvedValueOnce(fullPage).mockResolvedValue([])
    const delegate = { count: jest.fn().mockResolvedValue(101), findMany, updateMany: jest.fn((a: unknown) => a) }

    const { changed } = await rotateModel("transaction", { delegate, runTx: okTx, apply: true })

    expect(findMany).toHaveBeenCalledTimes(2)
    expect(changed).toBe(100)
  })
})
