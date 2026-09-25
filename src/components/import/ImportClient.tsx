"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import type { CheckResult } from "@/lib/csv"

type ImportResult = {
  imported: number
  skipped: number
  errors: Array<{ row: number; message: string }>
}

const SAMPLE_CSV = `family_name,member_no,address,suburb,state,postcode,first_name,last_name,dob,gender,role,classification,email,mobile
Smith,C90/91,12 High St,Sampletown,NSW,2150,John,Smith,1980-01-15,MALE,HEAD,MEMBER,john@example.com,0400000001
Smith,,,,,,Jane,Smith,1983-06-20,FEMALE,SPOUSE,MEMBER,jane@example.com,0400000002`

export function ImportClient() {
  const [file, setFile] = useState<File | null>(null)
  // The exact File that produced the current preview — confirmation submits this,
  // not whatever is in `file`, so a second pick mid-check can't import unchecked.
  const [checkedFile, setCheckedFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<CheckResult | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Mirrors the latest picked File so a slow check response for a since-replaced
  // file can be dropped instead of republishing its stale preview.
  const latestFileRef = useRef<File | null>(null)
  const router = useRouter()

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return

    setLoading(true)
    setError(null)
    setPreview(null)
    setCheckedFile(null)
    setResult(null)

    const picked = file
    const formData = new FormData()
    formData.set("file", picked)

    try {
      const res = await fetch("/api/import/families/check", { method: "POST", body: formData })
      const body = await res.json()

      // A newer file was picked while this check was in flight — drop the stale result.
      if (latestFileRef.current !== picked) return

      if (!res.ok) {
        setError(body.error ?? "Check failed")
      } else {
        setPreview(body)
        setCheckedFile(picked)
      }
    } catch {
      setError("Unexpected error. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    if (!checkedFile) return

    setLoading(true)
    setError(null)

    const formData = new FormData()
    formData.set("file", checkedFile)

    try {
      const res = await fetch("/api/import/families", { method: "POST", body: formData })
      const body = await res.json()

      if (!res.ok) {
        setError(body.error ?? "Import failed")
      } else {
        setResult(body)
        setPreview(null)
        setCheckedFile(null)
      }
    } catch {
      setError("Unexpected error. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  function handleCancel() {
    setFile(null)
    setPreview(null)
    setCheckedFile(null)
    setResult(null)
    setError(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "import-sample.csv"
    // Firefox ignores programmatic click() on an element not in the DOM.
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Defer revocation — a.click() starts an async download; revoking the blob
    // URL synchronously can abort it on Firefox/older Chromium.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  // Deduplicate rows by family name for preview (show one row per unique person)
  const previewRows = preview?.rows ?? []
  const duplicateSet = new Set(preview?.duplicates ?? [])
  const newFamilyCount = preview
    ? Array.from(new Set(previewRows.map((r) => r.family.name))).filter(
        (name) => !duplicateSet.has(name)
      ).length
    : 0

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-foreground">Import CSV</h2>
        <Button variant="outline" size="sm" onClick={downloadSample}>
          Download sample CSV
        </Button>
      </div>

      {!preview && !result && (
        <form onSubmit={handleCheck} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="file">CSV file</Label>
            <div className="flex items-center gap-3">
              <input
                id="file"
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const picked = e.target.files?.[0] ?? null
                  latestFileRef.current = picked
                  setFile(picked)
                  setPreview(null)
                  setCheckedFile(null)
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
              >
                Browse…
              </Button>
              <span className="text-sm text-muted-foreground">
                {file ? file.name : "No file chosen"}
              </span>
            </div>
          </div>
          {error && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="flex gap-3">
            <Button type="submit" disabled={!file || loading}>
              {loading ? "Checking..." : "Check for duplicates"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push("/families")}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {preview && (
        <div className="space-y-4">
          {preview.errors.length > 0 && (
            <div className="rounded-md bg-warning/10 border border-warning/40 px-4 py-3 text-sm text-warning">
              {preview.errors.length} row{preview.errors.length !== 1 ? "s" : ""} have parse errors and will be skipped.
            </div>
          )}

          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Family</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((row, i) => (
                <TableRow key={`${row.family.name}-${row.person.firstName}-${row.person.lastName}-${i}`}>
                  <TableCell className="font-medium">{row.family.name}</TableCell>
                  <TableCell>{row.person.firstName} {row.person.lastName}</TableCell>
                  <TableCell>
                    {duplicateSet.has(row.family.name) ? (
                      <Badge variant="outline" className="text-warning border-warning/40 bg-warning/10">
                        Exists — will skip
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-success border-success/40 bg-success/10">
                        New
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <Button onClick={handleConfirm} disabled={loading || newFamilyCount === 0}>
              {loading
                ? "Importing..."
                : `Import ${newFamilyCount} ${newFamilyCount === 1 ? "family" : "families"}${duplicateSet.size > 0 ? ` (${duplicateSet.size} duplicate${duplicateSet.size !== 1 ? "s" : ""} will be skipped)` : ""}`}
            </Button>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="flex gap-4 text-sm">
            <span className="text-success font-medium">{result.imported} imported</span>
            <span className="text-muted-foreground">{result.skipped} skipped</span>
            {result.errors.length > 0 && (
              <span className="text-destructive font-medium">{result.errors.length} errors</span>
            )}
          </div>

          {result.errors.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Issue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.errors.map((err, i) => (
                  <TableRow key={`${err.row}-${i}`}>
                    <TableCell>
                      <Badge variant="destructive">{err.row}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-destructive">{err.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => router.push("/families")}>
              {result.imported > 0 && result.errors.length === 0
                ? "View families"
                : "Back to families"}
            </Button>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Try another file
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
