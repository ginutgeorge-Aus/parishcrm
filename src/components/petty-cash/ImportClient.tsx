"use client"
import { useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { previewImport, commitImport, type ImportPreview } from "@/lib/actions/pettyCashImport"
import { fmtAUD } from "@/lib/formatting"

export function ImportClient({ custodians }: { custodians: { id: number; name: string }[] }) {
  const [csv, setCsv] = useState("")
  const [custodianId, setCustodianId] = useState("")
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [overrides, setOverrides] = useState<Record<string, number | null>>({})
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(null)
  const [pending, start] = useTransition()
  const previewVersion = useRef(0)
  const fileVersion = useRef(0)

  async function onFile(file: File | undefined) {
    const version = ++fileVersion.current
    ++previewVersion.current
    setCsv("")
    setPreview(null); setMsg(null); setOverrides({})
    if (!file) return
    const text = await file.text()
    if (version !== fileVersion.current) return
    ++previewVersion.current
    setCsv(text)
  }
  // A preview is computed for one custodian's session; switching custodian must
  // invalidate it so Commit can't post reviewed rows under a different
  // custodian's session. Forces a fresh Preview before Commit reappears.
  function onCustodianChange(value: string) {
    ++previewVersion.current
    setCustodianId(value)
    setPreview(null); setMsg(null); setOverrides({})
  }
  function buildForm() {
    const f = new FormData()
    f.set("csv", csv); f.set("custodianId", custodianId); f.set("donorOverrides", JSON.stringify(overrides))
    return f
  }
  function doPreview() {
    const version = ++previewVersion.current
    setMsg(null)
    start(async () => {
      const r = await previewImport(buildForm())
      if (version !== previewVersion.current) return
      if ("error" in r) setMsg({ kind: "error", text: r.error })
      else setPreview(r.preview)
    })
  }
  function doCommit() {
    setMsg(null)
    start(async () => {
      const r = await commitImport(buildForm())
      if ("error" in r) setMsg({ kind: "error", text: r.error })
      else { setMsg({ kind: "ok", text: r.success }); setPreview(null); setCsv(""); setOverrides({}) }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files?.[0])}
          aria-label="CSV file"
          className="text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-accent"
        />
        <Select value={custodianId} onValueChange={onCustodianChange}>
          <SelectTrigger className="w-44" aria-label="Custodian">
            <SelectValue placeholder="Select custodian…" />
          </SelectTrigger>
          <SelectContent>
            {custodians.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={doPreview} disabled={pending || !csv || !custodianId}>Preview</Button>
      </div>

      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-sm ${msg.kind === "error" ? "text-destructive" : "text-success"}`}>{msg.text}</p>}

      {preview && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {preview.rows.length} rows · {preview.sessions.length} session(s) · receipts {fmtAUD(preview.receiptTotal)} · expenses {fmtAUD(preview.expenseTotal)}
            {preview.hardErrorCount > 0 && <span className="text-destructive"> · {preview.hardErrorCount} error(s)</span>}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th scope="col" className="py-2 px-2">#</th><th scope="col" className="px-2">Date</th><th scope="col" className="px-2">Type</th><th scope="col" className="px-2">Account</th><th scope="col" className="px-2">Payee/Donor</th><th scope="col" className="px-2 text-right">Amount</th><th scope="col" className="px-2">Status</th>
              </tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.rowNumber} className="border-b border-border">
                    <td className="py-1.5 px-2 text-muted-foreground">{r.rowNumber}</td>
                    <td className="px-2">{r.rawDate}</td>
                    <td className="px-2">{r.type}</td>
                    <td className="px-2">{r.accountName}</td>
                    <td className="px-2">{r.payeeOrDonor || "—"}</td>
                    <td className="px-2 text-right tabular">{r.amount != null ? fmtAUD(r.amount) : "—"}</td>
                    <td className="px-2">
                      {r.errors.length > 0 ? <span className="text-destructive">{r.errors.join("; ")}</span>
                        : r.donor.status === "ambiguous"
                          ? <select aria-label={`Select donor for row ${r.rowNumber}`} className="border rounded text-xs" value={overrides[String(r.rowNumber)] ?? ""} onChange={(e) => { ++previewVersion.current; setPreview(null); setMsg(null); setOverrides((o) => ({ ...o, [String(r.rowNumber)]: e.target.value ? Number(e.target.value) : null })) }}>
                              <option value="">(leave unlinked)</option>
                              {r.donor.candidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                          : r.donor.status === "matched" ? <span className="text-success">→ {r.donor.label}</span>
                          : <span className="text-muted-foreground">ok</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button size="sm" onClick={doCommit} disabled={pending || preview.hardErrorCount > 0}>
            {pending ? "Importing…" : "Commit import"}
          </Button>
        </div>
      )}
    </div>
  )
}
