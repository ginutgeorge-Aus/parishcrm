import type { ReviewRow } from "@/lib/bankTypes"

// Bank import review draft, persisted to sessionStorage so per-row
// selections survive a refresh or accidental navigation. Session-scoped
// on purpose — descriptions can contain member names.
const KEY = "bankImportDraft.v1"
// Tombstones of draft content already imported this session, held as a SET of
// compact content hashes (JSON array). Guards against a posted draft being
// re-offered for confirmation — whether by a plain revisit or by a remounted
// instance whose persistence effect fires just after the import cleared storage
//. Two properties matter (round-5 codex):
//   • Hashes, not full serializations — a 1000-row draft stored verbatim as a
//     second copy could blow the sessionStorage quota and abort cleanup.
//   • A set, not a single value — overlapping in-flight imports (draft A and B)
//     must each stay tombstoned; a singleton would drop the earlier one when the
//     later request resolves, letting a remount re-save the already-posted draft.
const IMPORTED_KEY = "bankImportDraft.imported.v2"
// Bound the tombstone set so a long session with many imports can't grow it
// without limit; the oldest entries fall off. Far above any realistic per-
// session import count.
const MAX_TOMBSTONES = 50

// Compact 32-bit content hash (djb2) rendered base-36. Collisions only risk
// treating one distinct draft as already-imported within a single session —
// negligible for the handful of imports a session sees, and vastly cheaper to
// store than the full serialization.
function hashFingerprint(fingerprint: string): string {
  let h = 5381
  for (let i = 0; i < fingerprint.length; i++) {
    h = ((h << 5) + h) ^ fingerprint.charCodeAt(i)
  }
  return (h >>> 0).toString(36)
}

function readTombstones(): string[] {
  try {
    const raw = sessionStorage.getItem(IMPORTED_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === "string") : []
  } catch {
    return []
  }
}

function isImported(fingerprint: string): boolean {
  return readTombstones().includes(hashFingerprint(fingerprint))
}

export type BankImportDraft = {
  rows: ReviewRow[]
  period: { from: string; to: string } | null
  paymentAccountId: number | ""
}

export function saveDraft(draft: BankImportDraft): void {
  try {
    // Never re-persist content already imported this session — a late remount
    // persistence effect would otherwise write the posted review back.
    if (isImported(draftFingerprint(draft))) return
    sessionStorage.setItem(KEY, JSON.stringify(draft))
  } catch {
    // storage full or unavailable — drop the draft silently
  }
}

// Minimal shape check: sessionStorage is user-editable, so a corrupted
// draft must not put wrong-typed fields into client state. Whole draft is
// dropped on any bad row — same recovery as corrupt JSON.
function isValidSplit(s: unknown): boolean {
  if (typeof s !== "object" || s === null) return false
  const line = s as Record<string, unknown>
  return (
    (line.accountId === null || typeof line.accountId === "number") &&
    typeof line.amount === "string" &&
    (line.familyId === null || typeof line.familyId === "number") &&
    (line.personId === null || typeof line.personId === "number")
  )
}

function isValidRow(r: unknown): r is ReviewRow {
  if (typeof r !== "object" || r === null) return false
  const row = r as Record<string, unknown>
  return (
    typeof row.date === "string" &&
    typeof row.description === "string" &&
    typeof row.details === "string" &&
    typeof row.amount === "string" &&
    (row.type === "INCOME" || row.type === "EXPENSE") &&
    typeof row.bankRef === "string" &&
    (row.accountId === null || typeof row.accountId === "number") &&
    (row.familyId === null || typeof row.familyId === "number") &&
    (row.personId === null || typeof row.personId === "number") &&
    typeof row.skip === "boolean" &&
    typeof row.isDuplicate === "boolean" &&
    typeof row.fromPettyCash === "boolean" &&
    (row.splits === undefined ||
      (Array.isArray(row.splits) && row.splits.every(isValidSplit)))
  )
}

export function loadDraft(): BankImportDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BankImportDraft
    if (!Array.isArray(parsed?.rows) || parsed.rows.length === 0) return null
    if (!parsed.rows.every(isValidRow)) return null
    if (parsed.paymentAccountId !== "" && typeof parsed.paymentAccountId !== "number") return null
    // Already imported this session — don't re-offer the posted review.
    // Checked on the normalization-invariant fingerprint so a draft whose
    // category was cleared on restore (deactivated account) still matches its
    // imported tombstone (round-6 codex).
    if (isImported(draftFingerprint(parsed))) return null
    return parsed
  } catch {
    return null
  }
}

// On restore, drop accountIds whose account was since deleted or reclassified
// to the other type — the type-scoped dropdown can't display them, so
// the select would show blank while state kept the stale id.
export function clearMismatchedAccountIds(
  rows: ReviewRow[],
  accounts: { id: number; type: "INCOME" | "EXPENSE" }[]
): ReviewRow[] {
  const typeById = new Map(accounts.map((a) => [a.id, a.type]))
  const stale = (id: number | null, rowType: "INCOME" | "EXPENSE") =>
    id !== null && typeById.get(id) !== rowType
  return rows.map((r) => {
    const next = stale(r.accountId, r.type) ? { ...r, accountId: null } : r
    if (!next.splits) return next
    return {
      ...next,
      splits: next.splits.map((s) =>
        stale(s.accountId, r.type) ? { ...s, accountId: null } : s
      ),
    }
  })
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

// Content fingerprint of a draft. Ownership of a draft is its content, not the
// client instance: a remount that restores the same draft keeps the same
// fingerprint, while any edit of the bank lines or a new upload changes it
//. Row/split `accountId`s are excluded because restore normalizes
// them (an account deactivated between import and the delayed success response
// is cleared by `clearMismatchedAccountIds`) — including them would let the
// normalized copy miss its own imported tombstone (round-6 codex).
export function draftFingerprint(draft: BankImportDraft): string {
  return JSON.stringify({
    rows: draft.rows.map((r) => ({
      ...r,
      accountId: null,
      splits: r.splits?.map((s) => ({ ...s, accountId: null })),
    })),
    period: draft.period,
    paymentAccountId: draft.paymentAccountId,
  })
}

// Mark the exact content that was just imported as consumed for the rest of the
// session, and drop the live draft if it still matches. The tombstone makes the
// clear durable: `loadDraft` skips it on any later revisit and `saveDraft`
// refuses to write it back, so neither a plain revisit nor a remounted
// instance's late persistence effect can re-offer the already-posted review
//. A newer review the operator edited/re-uploaded has a different
// fingerprint, so it is neither tombstoned nor cleared.
export function markImported(fingerprint: string): void {
  try {
    // Drop the live draft FIRST so the successful-import cleanup lands even if
    // the tombstone write below fails under quota pressure (round-5 codex).
    // Compare on the stored draft's fingerprint, not a raw string match — the
    // fingerprint is normalization-invariant, so a draft whose category was
    // cleared on restore still matches what was submitted (round-6 codex).
    const raw = sessionStorage.getItem(KEY)
    if (raw !== null) {
      let storedFingerprint: string | null = null
      try {
        storedFingerprint = draftFingerprint(JSON.parse(raw) as BankImportDraft)
      } catch {
        storedFingerprint = null
      }
      if (storedFingerprint === fingerprint) sessionStorage.removeItem(KEY)
    }
    // Append this content's hash to the tombstone set, keeping earlier imports
    // so overlapping in-flight confirmations don't evict one another.
    const hash = hashFingerprint(fingerprint)
    const tombstones = readTombstones()
    if (!tombstones.includes(hash)) {
      tombstones.push(hash)
      sessionStorage.setItem(IMPORTED_KEY, JSON.stringify(tombstones.slice(-MAX_TOMBSTONES)))
    }
  } catch {
    // ignore
  }
}

// After a re-upload, carry the user's selections (category, member, skip,
// cash-transfer flag) onto the freshly parsed rows, matched by bankRef.
// Parsed fields (description, amount, isDuplicate, …) come from the fresh row.
export function mergeDraftSelections(newRows: ReviewRow[], prevRows: ReviewRow[]): ReviewRow[] {
  if (prevRows.length === 0) return newRows
  const byRef = new Map(prevRows.map((r) => [r.bankRef, r]))
  return newRows.map((r) => {
    const prev = byRef.get(r.bankRef)
    if (!prev) return r
    return {
      ...r,
      accountId: prev.accountId,
      familyId: prev.familyId,
      personId: prev.personId,
      splits: prev.splits,
      // duplicates flagged by the new upload stay pre-skipped; otherwise the
      // user's skip choice wins
      skip: r.isDuplicate ? true : prev.skip,
      fromPettyCash: prev.fromPettyCash,
    }
  })
}
