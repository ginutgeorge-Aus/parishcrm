"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ImportStepper, type WizardStep } from "./import/ImportStepper"
import { SourceStep } from "./import/SourceStep"
import { UploadStep, type UploadResult } from "./import/UploadStep"
import { DoneStep } from "./import/DoneStep"
import type { ImportSource } from "@/lib/importSources"
import { rememberBankImportAccount } from "@/lib/actions/bankImport"
import { BankReviewTable } from "./BankReviewTable"
import type { Account, Family, ReviewRow } from "./BankReviewTable"
import { wordBoundaryMatch } from "@/lib/bankMatch"
import { applyBulkSkip } from "@/lib/bankReviewFilter"
import { saveDraft, loadDraft, markImported, draftFingerprint, mergeDraftSelections, clearMismatchedAccountIds, } from "@/lib/bankImportDraft"
import type { PaymentAccountLite } from "@/lib/paymentAccounts"

// Pass-2 bankingName aliases shorter than this are too collision-prone to
// auto-match against free-text bank descriptions.
const MIN_BANKING_NAME_LEN = 4

export function matchPerson(
  text: string,
  families: Family[]
): { familyId: number | null; personId: number | null } {
  const upper = text.toUpperCase()

  const collect = (
    pred: (person: Family["people"][number]) => boolean
  ): { familyId: number; personId: number }[] => {
    const hits: { familyId: number; personId: number }[] = []
    for (const family of families) {
      for (const person of family.people) {
        if (pred(person)) hits.push({ familyId: family.id, personId: person.id })
      }
    }
    return hits
  }

  // Pass 1: full name. Pass 2 (only when no name hit): bankingName.
  // More than one distinct person matching is ambiguous — leave it unattributed
  // so a human assigns it, rather than silently crediting whichever family sorts
  // first and mis-recording another member's giving.
  const byName = collect((p) => wordBoundaryMatch(upper, `${p.firstName} ${p.lastName}`.toUpperCase()))
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) return { familyId: null, personId: null }

  // Require a minimum bankingName length in pass 2: wordBoundaryMatch treats
  // digits/spaces/apostrophes as boundaries, so a very short alias (e.g. "K G",
  // "LEE") can land at a real boundary inside an unrelated payee string and
  // silently attribute another member's payment to the wrong family.
  const byBanking = collect(
    (p) => !!p.bankingName && p.bankingName.trim().length >= MIN_BANKING_NAME_LEN && wordBoundaryMatch(upper, p.bankingName.toUpperCase()),
  )
  if (byBanking.length === 1) return byBanking[0]

  return { familyId: null, personId: null }
}

/**
 * Applies a bulk category selection only to rows whose type matches the
 * account's type — an INCOME account never lands on an EXPENSE row. When
 * `indices` is given (the rows visible in the active filter), other rows are untouched.
 */
export function applyCategoryToRows(rows: ReviewRow[], account: Account, indices?: readonly number[]): ReviewRow[] {
  const target = indices ? new Set(indices) : null
  return rows.map((r, i) => (r.type === account.type && (!target || target.has(i)) ? { ...r, accountId: account.id } : r))
}

type ImportResult = { imported: number; skipped: number; duplicates: number }

export function BankImportClient({
  accounts,
  families,
  paymentAccounts,
}: Readonly<{
  accounts: Account[]
  families: Family[]
  paymentAccounts: PaymentAccountLite[]
}>) {
  const [view, setView] = useState<WizardStep>("source")
  const [source, setSource] = useState<ImportSource>("anz")
  // Last 4 digits of the parsed file's account (OFX/ANZ); "" for QIF or none.
  // The full number never reaches the browser. Sent to rememberBankImportAccount
  // after a successful import and kept in the session-scoped review draft.
  const [accountSuffix, setAccountSuffix] = useState("")
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null)
  const [paymentAccountId, setPaymentAccountId] = useState<number | "">("")
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const activeImport = useRef<symbol | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  // Restore a pending review draft (survives refresh / accidental navigation)
  useEffect(() => {
    const draft = loadDraft()
    if (draft) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows(clearMismatchedAccountIds(draft.rows, accounts))
      setPeriod(draft.period)
      setPaymentAccountId(draft.paymentAccountId)
      if (draft.accountSuffix !== undefined) setAccountSuffix(draft.accountSuffix)
      if (draft.source !== undefined) setSource(draft.source)
      setView("review")
    }
    return () => {
      activeImport.current = null
    }
    // Mount-only restore; `accounts` is a server-provided prop, stable for the
    // page lifetime — re-running on identity change would clobber edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist the draft while reviewing
  useEffect(() => {
    if (view === "review" && rows.length > 0) {
      saveDraft({ rows, period, paymentAccountId, accountSuffix: accountSuffix || undefined, source })
    }
  }, [view, rows, period, paymentAccountId, accountSuffix, source])

  /** Build review rows from an Upload step result: auto-match members, pre-skip exact and possible duplicates. */
  function handleUploadComplete(upload: UploadResult) {
    if (activeImport.current !== null) return
    const dupSet = new Set<string>(upload.duplicateBankRefs)
    const possibleSet = new Set<string>(upload.possibleDuplicateBankRefs)
    const fresh = upload.rows.map((r) => {
      const matched = matchPerson(`${r.description} ${r.details}`, families)
      const isDuplicate = dupSet.has(r.bankRef)
      const isPossibleDuplicate = !isDuplicate && possibleSet.has(r.bankRef)
      return {
        ...r,
        accountId: null,
        skip: isDuplicate || isPossibleDuplicate,
        isDuplicate,
        isPossibleDuplicate,
        familyId: matched.familyId,
        personId: matched.personId,
        fromPettyCash: false,
      }
    })
    // Re-uploading the same statement keeps selections already made
    setRows(mergeDraftSelections(fresh, rows))
    setPeriod(upload.period)
    setPaymentAccountId(upload.paymentAccountId)
    setAccountSuffix(upload.accountSuffix)
    setParseErrors(upload.errors)
    setView("review")
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    // Freeze the review from confirmation until the request settles, so the
    // server can't import an earlier snapshot than what the operator sees.
    if (importing) return
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  /** Bulk-set a category on the rows at `indices` (the active filter's rows). */
  function setAllCategory(accountId: number, indices: readonly number[]) {
    if (importing) return
    const account = accounts.find((a) => a.id === accountId)
    if (!account) return
    setRows((prev) => applyCategoryToRows(prev, account, indices))
  }

  /** Bulk skip/unskip the rows at `indices`; unskipping leaves duplicates skipped. */
  function toggleSkipAll(skip: boolean, indices: readonly number[]) {
    if (importing) return
    setRows((prev) => applyBulkSkip(prev, skip, indices))
  }

  async function handleImport() {
    if (activeImport.current !== null) return
    const request = Symbol()
    activeImport.current = request
    // Fingerprint of exactly what we're submitting, so a success that resolves
    // after the operator navigated away clears the draft only if storage still
    // holds this identical content — never a newer review they edited or
    // re-uploaded in the meantime.
    const submitted = draftFingerprint({ rows, period, paymentAccountId })
    setImporting(true)
    setImportError(null)
    try {
      const res = await fetch("/api/import/bank-statement/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rows.map((r) => ({ ...r, paymentAccountId }))),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (activeImport.current === request) {
          setImportError(data.error ?? "Import failed")
        }
        return
      }
      const data = await res.json()
      // The server has persisted these rows. Clear the draft even if the
      // operator navigated away mid-request (unmount cleared activeImport) —
      // otherwise the already-posted review is restored from sessionStorage on
      // revisit and re-confirmed, reporting every row as a duplicate.
      // Fingerprint-matched so it clears an unchanged imported draft (incl. an
      // identical remount) but never a newer edited/re-uploaded one (codex).
      markImported(submitted)
      // Remember account-number → bank-account for next time (best effort; a
      // failure only means the user re-picks the account on the next upload).
      if (accountSuffix && typeof paymentAccountId === "number") {
        void rememberBankImportAccount(accountSuffix, paymentAccountId).catch(() => {})
      }
      if (activeImport.current !== request) return
      setResult(data)
      setView("done")
    } catch {
      if (activeImport.current === request) {
        setImportError("Network error — please retry.")
      }
    } finally {
      if (activeImport.current === request) {
        activeImport.current = null
        setImporting(false)
      }
    }
  }

  /** Reset to a fresh wizard after a completed import. */
  function startOver() {
    setRows([])
    setPeriod(null)
    setResult(null)
    setAccountSuffix("")
    setSource("anz")
    setPaymentAccountId("")
    setView("source")
  }

  let body: ReactNode
  if (view === "source") {
    body = <SourceStep value={source} onChange={setSource} onContinue={() => setView("upload")} />
  } else if (view === "upload") {
    body = (
      <UploadStep source={source} paymentAccounts={paymentAccounts} onBack={() => setView("source")} onComplete={handleUploadComplete} />
    )
  } else if (view === "done") {
    body = <DoneStep result={result} onAgain={startOver} />
  } else {
    body = (
      <BankReviewTable
        rows={rows}
        period={period}
        parseErrors={parseErrors}
        accounts={accounts}
        families={families}
        importError={importError}
        importing={importing}
        onUpdateRow={updateRow}
        onSetAllCategory={setAllCategory}
        onToggleSkipAll={toggleSkipAll}
        onConfirm={handleImport}
        onBack={() => {
          if (activeImport.current === null) setView("upload")
        }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <ImportStepper current={view} />
      {body}
    </div>
  )
}
