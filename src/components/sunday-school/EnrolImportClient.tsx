"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { commitEnrolmentImport, previewEnrolmentImport, type EnrolImportPreview } from "@/lib/actions/sundaySchoolImport"
import { ENROL_SAMPLE_CSV } from "@/lib/sundaySchoolCsv"

const LABEL = { enrol: "Enrol", move: "Move", unchanged: "Already in class", error: "Error" } as const

/**
 * Upload, preview and commit an enrolment CSV for one school year. The previewed
 * File is the one committed; any error row blocks the import. Rows render as
 * stacked cards below `sm`, a table above.
 */
export function EnrolImportClient({ year }: Readonly<{ year: number }>) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [checked, setChecked] = useState<File | null>(null)
  const [preview, setPreview] = useState<EnrolImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Validate the picked file; shows the per-row preview. */
  async function check(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setBusy(true)
    setError(null)
    setPreview(null)
    const fd = new FormData()
    fd.set("file", file)
    try {
      const r = await previewEnrolmentImport(year, fd)
      if ("error" in r) setError(r.error)
      else { setPreview(r.preview); setChecked(file) }
    } catch {
      setError("Unexpected error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  /** Commit the previewed file, then go back to the class list. */
  async function commit() {
    if (!checked) return
    setBusy(true)
    setError(null)
    const fd = new FormData()
    fd.set("file", checked)
    try {
      const r = await commitEnrolmentImport(year, fd)
      if ("error" in r) setError(r.error)
      else router.push(`/sunday-school?year=${year}&imported=${encodeURIComponent(r.success)}`)
    } catch {
      setError("Unexpected error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  /** Download the sample CSV. */
  function sample() {
    const url = URL.createObjectURL(new Blob([ENROL_SAMPLE_CSV], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "enrolment-sample.csv"
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const actionable = preview ? preview.rows.filter((r) => r.status === "enrol" || r.status === "move").length : 0

  return (
    <div className="space-y-4 max-w-3xl">
      <form onSubmit={check} className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Columns: <code>family_name</code>, <code>first_name</code>, <code>last_name</code>, <code>class_name</code>
          {" "}and optional <code>location</code> (only needed if two {year} classes share a name). Students must already be in People.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setChecked(null); setError(null) }}
          />
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" onClick={() => fileRef.current?.click()}>Browse…</Button>
          <span className="text-sm text-muted-foreground break-all">{file ? file.name : "No file chosen"}</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" className="min-h-11 sm:min-h-0" disabled={!file || busy}>{busy && !preview ? "Checking…" : "Check file"}</Button>
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" onClick={sample}>Download sample</Button>
        </div>
      </form>

      <FormFeedback state={{ error }} />

      {preview && (
        <div className="space-y-3">
          {preview.parseErrors.map((p) => (
            <p key={`${p.row}:${p.message}`} role="alert" className="text-sm text-destructive">
              {p.row > 0 ? `Row ${p.row}: ` : ""}{p.message}
            </p>
          ))}
          <ul className="divide-y divide-border rounded-md border border-border">
            {preview.rows.map((r) => (
              <li key={r.row} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm">
                <span className="font-medium text-foreground">{r.student} <span className="font-normal text-muted-foreground">({r.familyName})</span></span>
                <span className="text-muted-foreground">{r.className}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={r.status === "error" ? "destructive" : "secondary"}>{LABEL[r.status]}</Badge>
                  <span className="text-xs text-muted-foreground">Row {r.row}{r.message ? `: ${r.message}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
          {preview.errorCount > 0 ? (
            <p role="alert" className="text-sm text-destructive">
              {preview.errorCount} error{preview.errorCount === 1 ? "" : "s"}. Fix the file and check again — nothing is imported until every row is valid.
            </p>
          ) : (
            <Button className="min-h-11 sm:min-h-0" onClick={commit} disabled={busy || actionable === 0}>
              {busy ? "Importing…" : actionable === 0 ? "Nothing to change" : `Import ${actionable} enrolment${actionable === 1 ? "" : "s"}`}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
