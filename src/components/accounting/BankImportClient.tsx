"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BankUploadStep } from "./BankUploadStep"
import { BankReviewTable } from "./BankReviewTable"
import type { Account, Family, ReviewRow } from "./BankReviewTable"
import type { ParsedRow } from "@/lib/anzParser"
import { wordBoundaryMatch } from "@/lib/bankMatch"
import { saveDraft, loadDraft, markImported, draftFingerprint, mergeDraftSelections, clearMismatchedAccountIds } from "@/lib/bankImportDraft"
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

// Applies a bulk category selection only to rows whose type matches the
// account's type — an INCOME account never lands on an EXPENSE row.
export function applyCategoryToRows(rows: ReviewRow[], account: Account): ReviewRow[] {
  return rows.map((r) => (r.type === account.type ? { ...r, accountId: account.id } : r))
}

type ImportResult = { imported: number; skipped: number; duplicates: number }

export function BankImportClient({
  accounts,
  families,
  paymentAccounts,
}: {
  accounts: Account[]
  families: Family[]
  paymentAccounts: PaymentAccountLite[]
}) {
  const [view, setView] = useState<"upload" | "review" | "done">("upload")
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
      saveDraft({ rows, period, paymentAccountId })
    }
  }, [view, rows, period, paymentAccountId])

  function handleUploadComplete(
    rawRows: ParsedRow[],
    duplicates: string[],
    parsedPeriod: { from: string; to: string } | null,
    account: number,
    errors: string[]
  ) {
    if (activeImport.current !== null) return
    const dupSet = new Set<string>(duplicates)
    const fresh = rawRows.map((r) => {
      const matched = matchPerson(`${r.description} ${r.details}`, families)
      return {
        ...r,
        accountId: null,
        skip: dupSet.has(r.bankRef),
        isDuplicate: dupSet.has(r.bankRef),
        familyId: matched.familyId,
        personId: matched.personId,
        fromPettyCash: false,
      }
    })
    // Re-uploading the same statement keeps selections already made
    setRows(mergeDraftSelections(fresh, rows))
    setPeriod(parsedPeriod)
    setPaymentAccountId(account)
    setParseErrors(errors)
    setView("review")
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    // Freeze the review from confirmation until the request settles, so the
    // server can't import an earlier snapshot than what the operator sees.
    if (importing) return
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function setAllCategory(accountId: number) {
    if (importing) return
    const account = accounts.find((a) => a.id === accountId)
    if (!account) return
    setRows((prev) => applyCategoryToRows(prev, account))
  }

  function toggleSkipAll(skip: boolean) {
    if (importing) return
    setRows((prev) => prev.map((r) => ({ ...r, skip })))
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

  if (view === "upload") {
    return <BankUploadStep paymentAccounts={paymentAccounts} onUploadComplete={handleUploadComplete} />
  }

  if (view === "done") {
    return (
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle>Import Complete</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            Imported: <strong>{result?.imported}</strong> · Skipped:{" "}
            <strong>{result?.skipped}</strong> · Duplicates:{" "}
            <strong>{result?.duplicates}</strong>
          </p>
          <Button asChild variant="outline">
            <Link href="/accounting/transactions">View Transactions</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
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
