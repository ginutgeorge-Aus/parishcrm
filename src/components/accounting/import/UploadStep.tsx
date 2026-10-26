"use client"

import { useRef, useState } from "react"
import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { ParsedRow } from "@/lib/anzParser"
import type { PaymentAccountLite } from "@/lib/paymentAccounts"
import { radioGroupKeyDown } from "./radioKeys"
import { IMPORT_SOURCES, MAX_UPLOAD_LABEL, matchesAccept, type ImportSource } from "@/lib/importSources"

export type UploadResult = {
  rows: ParsedRow[]
  duplicateBankRefs: string[]
  possibleDuplicateBankRefs: string[]
  period: { from: string; to: string } | null
  accountNumber: string
  paymentAccountId: number
  errors: string[]
}

type Parsed = Omit<UploadResult, "paymentAccountId"> & { autoMatched: boolean }
type DateOrder = "DMY" | "MDY"

/** Step 2: upload one export file, show what was read, and pick/confirm the ParishCRM bank account. */
export function UploadStep({
  source,
  paymentAccounts,
  onBack,
  onComplete,
}: Readonly<{
  source: ImportSource
  paymentAccounts: PaymentAccountLite[]
  onBack: () => void
  onComplete: (r: UploadResult) => void
}>) {
  const cfg = IMPORT_SOURCES[source]
  const defaultBankId = paymentAccounts.find((a) => a.kind === "BANK" && a.isDefault && a.isActive)?.id
  const [paymentAccountId, setPaymentAccountId] = useState<number | "">(defaultBankId ?? "")
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [dateOrder, setDateOrder] = useState<DateOrder>("DMY")
  const [dateAmbiguous, setDateAmbiguous] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Latest read() request; a response from an older one must not touch state.
  const readSeq = useRef(0)
  // dragenter/dragleave also fire for child elements, so count them to avoid flicker.
  const dragDepth = useRef(0)
  const isQif = source === "qif"

  /** POST the file to the parse route; QIF also sends the account and (if chosen) date order. */
  async function read(f: File, opts: { account?: number | ""; order?: DateOrder } = {}) {
    const account = opts.account ?? paymentAccountId
    if (isQif && !account) {
      setError("Choose the bank account first.")
      return
    }
    const seq = ++readSeq.current
    setUploading(true)
    setError(null)
    // Drop the previous parse up front so a failed read can never leave old rows behind.
    setParsed(null)
    const fd = new FormData()
    fd.append("file", f)
    fd.append("source", source)
    if (isQif) {
      fd.append("paymentAccountId", String(account))
      if (opts.order) fd.append("dateOrder", opts.order)
    }
    try {
      const res = await fetch("/api/import/bank-statement", { method: "POST", body: fd })
      const data = await res.json().catch(() => ({}))
      if (seq !== readSeq.current) return
      if (!res.ok) {
        setParsed(null)
        setError(data.error ?? "Couldn't read this file.")
        return
      }
      setParsed({
        rows: data.rows,
        duplicateBankRefs: data.duplicateBankRefs ?? [],
        possibleDuplicateBankRefs: data.possibleDuplicateBankRefs ?? [],
        period: data.period ?? null,
        accountNumber: data.accountNumber ?? "",
        errors: data.errors ?? [],
        autoMatched: typeof data.suggestedPaymentAccountId === "number",
      })
      // Sticky per file: a re-read with an explicit order reports not-ambiguous, but the user must still be able to switch back.
      if (data.dateFormatAmbiguous === true) setDateAmbiguous(true)
      if (typeof data.suggestedPaymentAccountId === "number") setPaymentAccountId(data.suggestedPaymentAccountId)
    } catch {
      if (seq === readSeq.current) setError("Network error — please retry.")
    } finally {
      if (seq === readSeq.current) setUploading(false)
    }
  }

  /** Accept a picked or dropped file and read it straight away. */
  function accept(f: File | undefined) {
    if (!f) return
    if (!matchesAccept(f, cfg.accept)) {
      setError(`That file type isn't supported. Please choose a ${cfg.acceptLabel} file.`)
      return
    }
    setFile(f)
    // A new file starts from the default account; the parse response may suggest a better one.
    if (!isQif) setPaymentAccountId(defaultBankId ?? "")
    setDateOrder("DMY")
    setDateAmbiguous(false)
    void read(f)
  }

  /** QIF bankRefs embed the account, so changing it after a read forces a re-read. */
  function changeAccount(id: number) {
    setPaymentAccountId(id)
    if (isQif && file) void read(file, { account: id, order: dateOrder })
    else if (parsed) setParsed({ ...parsed, autoMatched: false })
  }

  const accountSelect = (
    <div className="space-y-1">
      <label htmlFor="import-bank-account" className="text-sm font-medium">Bank account in ParishCRM</label>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={paymentAccountId === "" ? "" : String(paymentAccountId)} onValueChange={(v: string) => changeAccount(Number(v))}>
          <SelectTrigger id="import-bank-account" className="w-full sm:w-72">
            <SelectValue placeholder="Select account…" />
          </SelectTrigger>
          <SelectContent>
            {paymentAccounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {parsed?.autoMatched && (
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">Auto-matched from file</span>
        )}
      </div>
    </div>
  )

  const suffix = parsed?.accountNumber.replace(/\D/g, "").slice(-4)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload your {cfg.label} file</CardTitle>
        <CardDescription>{cfg.exportHelp}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isQif && accountSelect}

        <label
          htmlFor="import-file"
          onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setDragging(true) }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false) }}
          onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); accept(e.dataTransfer.files[0]) }}
          className={cn(
            "flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed bg-background p-6 text-center has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
            dragging && "border-primary bg-secondary",
          )}
        >
          <Upload className="size-5 text-muted-foreground" aria-hidden />
          <span className="text-sm"><strong>Drop file here</strong> or <span className="underline">browse</span></span>
          <span className="text-xs text-muted-foreground">{cfg.acceptLabel} · max {MAX_UPLOAD_LABEL} · one file</span>
          <input
            ref={inputRef}
            id="import-file"
            aria-label="Statement file"
            type="file"
            accept={cfg.accept}
            className="sr-only"
            onChange={(e) => {
              accept(e.target.files?.[0])
              // Reset so picking the same file again still fires change.
              e.target.value = ""
            }}
          />
        </label>

        {uploading && <p className="text-sm text-muted-foreground">Reading file…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {parsed && file && !uploading && (
          <div className="space-y-2 rounded-md border bg-card p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">Read</span>
              <strong className="break-all">{file.name}</strong>
              <span className="text-muted-foreground">
                {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}
                {parsed.period?.from && ` · ${parsed.period.from} – ${parsed.period.to}`}
                {suffix && ` · acct ••• ${suffix}`}
              </span>
            </div>
            {parsed.errors.length > 0 && <p className="text-warning">{parsed.errors[0]}</p>}
          </div>
        )}

        {/* Outside the summary so a failed re-read can still be retried or undone. */}
        {dateAmbiguous && file && (
          <div role="radiogroup" aria-label="Date format" onKeyDown={radioGroupKeyDown} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Dates in this file could be either format:</span>
            {(["DMY", "MDY"] as const).map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={dateOrder === o}
                tabIndex={dateOrder === o ? 0 : -1}
                onClick={() => { setDateOrder(o); void read(file, { order: o }) }}
                className={cn("min-h-11 rounded-full border px-3", dateOrder === o && "border-primary bg-primary text-primary-foreground")}
              >
                {o === "DMY" ? "DD/MM" : "MM/DD"}
              </button>
            ))}
          </div>
        )}

        {!isQif && parsed && accountSelect}

        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button
            disabled={!parsed || !paymentAccountId || uploading}
            onClick={() => parsed && paymentAccountId && onComplete({
              rows: parsed.rows,
              duplicateBankRefs: parsed.duplicateBankRefs,
              possibleDuplicateBankRefs: parsed.possibleDuplicateBankRefs,
              period: parsed.period,
              accountNumber: parsed.accountNumber,
              paymentAccountId,
              errors: parsed.errors,
            })}
          >
            Continue to review
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
