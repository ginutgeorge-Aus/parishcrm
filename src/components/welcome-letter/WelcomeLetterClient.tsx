"use client"

import { useRef, useState, useTransition } from "react"
import { buildWelcomeLetterDraft, sendWelcomeLetter, type WelcomeLetterRecipient } from "@/lib/actions/welcomeLetter"
import type { WelcomeLetterModel } from "@/lib/welcomeLetter"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"

type FamilyOpt = { id: number; name: string; memberNo: string | null }

export function WelcomeLetterClient({ families }: { families: FamilyOpt[] }) {
  const [familyId, setFamilyId] = useState<number | null>(null)
  const [model, setModel] = useState<WelcomeLetterModel | null>(null)
  const [recipients, setRecipients] = useState<WelcomeLetterRecipient[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null)
  const [loading, startLoad] = useTransition()
  const [sending, startSend] = useTransition()

  const pendingIdRef = useRef<number | null>(null)

  const load = (id: number) => {
    setFamilyId(id)
    pendingIdRef.current = id
    setModel(null)
    setRecipients([])
    setSelected(new Set())
    setMsg(null)
    startLoad(async () => {
      try {
        const r = await buildWelcomeLetterDraft(id)
        if (pendingIdRef.current !== id) return
        if ("error" in r) { setMsg({ kind: "err", text: r.error }); return }
        setModel(r.model)
        setRecipients(r.recipients)
        setSelected(new Set(r.recipients.map((x) => x.personId)))
      } catch {
        if (pendingIdRef.current !== id) return
        setMsg({ kind: "err", text: "Could not load the draft. Please try again." })
      }
    })
  }

  const set = <K extends keyof WelcomeLetterModel>(key: K, value: WelcomeLetterModel[K]) =>
    setModel((m) => (m ? { ...m, [key]: value } : m))

  const setBank = (i: number, field: "bank" | "bsb" | "account" | "accountName", value: string) =>
    setModel((m) => {
      if (!m) return m
      const bankAccounts = m.bankAccounts.map((a, idx) => (idx === i ? { ...a, [field]: value } : a))
      return { ...m, bankAccounts }
    })

  const preview = async () => {
    if (!model) return
    try {
      const res = await fetch("/api/welcome-letter/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(model),
      })
      if (!res.ok) { setMsg({ kind: "err", text: "Preview failed" }); return }
      const blob = await res.blob()
      window.open(URL.createObjectURL(blob), "_blank")
    } catch {
      setMsg({ kind: "err", text: "Preview failed" })
    }
  }

  const send = () => {
    if (!model || familyId == null) return
    setMsg(null)
    startSend(async () => {
      try {
        const r = await sendWelcomeLetter({ familyId, model, recipientPersonIds: [...selected] })
        if (r && "error" in r) setMsg({ kind: "err", text: r.error })
        else if (r && "success" in r) setMsg({ kind: "ok", text: r.success })
      } catch {
        setMsg({ kind: "err", text: "Could not send the letter. Please try again." })
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Family picker — native select keeps it simple for a bounded list. */}
      <div className="grid gap-1.5">
        <Label htmlFor="family">Family</Label>
        <select
          id="family"
          className="min-h-11 rounded-md border bg-background px-3 text-sm"
          value={familyId ?? ""}
          onChange={(e) => e.target.value && load(Number(e.target.value))}
        >
          <option value="" disabled>Select a family…</option>
          {families.map((f) => (
            <option key={f.id} value={f.id}>{f.name}{f.memberNo ? ` — ${f.memberNo}` : ""}</option>
          ))}
        </select>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading draft…</p>}

      {model && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="date">Date</Label>
              <Input id="date" value={model.date} maxLength={40} onChange={(e) => set("date", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="memberNo">Membership No.</Label>
              <Input id="memberNo" value={model.memberNo ?? ""} maxLength={40} onChange={(e) => set("memberNo", e.target.value)} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="addressee">Addressee</Label>
            <Input id="addressee" value={model.addresseeName} maxLength={200} onChange={(e) => set("addresseeName", e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="address">Address (one line each)</Label>
            <Textarea id="address" rows={2} value={model.addressLines.join("\n")}
              onChange={(e) => set("addressLines", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="greeting">Greeting name</Label>
            <Input id="greeting" value={model.greetingName} maxLength={200} onChange={(e) => set("greetingName", e.target.value)} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={model.includeTransfer}
              onCheckedChange={(v) => set("includeTransfer", v === true)} />
            Include transfer-certificate paragraph
          </label>
          {model.includeTransfer && (
            <div className="grid gap-1.5">
              <Label htmlFor="transfer">Transfer from church</Label>
              <Input id="transfer" value={model.transferChurch} maxLength={200} onChange={(e) => set("transferChurch", e.target.value)} />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="members">Members welcomed (one per line)</Label>
            <Textarea id="members" rows={4} value={model.members.join("\n")}
              onChange={(e) => set("members", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="intro">Body</Label>
            <Textarea id="intro" rows={8} value={model.bodyIntro} onChange={(e) => set("bodyIntro", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="contrib">Contributions intro</Label>
            <Textarea id="contrib" rows={3} value={model.contributionsIntro} onChange={(e) => set("contributionsIntro", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="closing">Closing</Label>
            <Textarea id="closing" rows={3} value={model.bodyClosing} onChange={(e) => set("bodyClosing", e.target.value)} />
          </div>

          {/* Bank accounts (editable per-letter; prefilled from settings). */}
          {model.bankAccounts.map((a, i) => (
            <fieldset key={a.fundLabel} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium">{a.taxDeductible ? `${a.fundLabel} (Tax Deductible)` : a.fundLabel}</legend>
              <Input placeholder="Bank" value={a.bank} maxLength={100} onChange={(e) => setBank(i, "bank", e.target.value)} />
              <Input placeholder="BSB" value={a.bsb} maxLength={20} onChange={(e) => setBank(i, "bsb", e.target.value)} />
              <Input placeholder="Account Number" value={a.account} maxLength={30} onChange={(e) => setBank(i, "account", e.target.value)} />
              <Input placeholder="Account Name" value={a.accountName} maxLength={120} onChange={(e) => setBank(i, "accountName", e.target.value)} />
            </fieldset>
          ))}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="signer">Signer name</Label>
              <Input id="signer" value={model.signerName} maxLength={120} onChange={(e) => set("signerName", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="signerTitle">Signer title</Label>
              <Input id="signerTitle" value={model.signerTitle} maxLength={120} onChange={(e) => set("signerTitle", e.target.value)} />
            </div>
          </div>

          {/* Recipients */}
          <div className="grid gap-2">
            <Label>Send to</Label>
            {recipients.length === 0 && <p className="text-sm text-muted-foreground">No family member has an email address on file.</p>}
            {recipients.map((r) => (
              <label key={r.personId} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.has(r.personId)}
                  onCheckedChange={(v) =>
                    setSelected((s) => {
                      const next = new Set(s)
                      if (v === true) next.add(r.personId); else next.delete(r.personId)
                      return next
                    })
                  }
                />
                {r.name} — {r.email}
              </label>
            ))}
          </div>

          {msg && (
            <p
              role={msg.kind === "ok" ? "status" : "alert"}
              aria-live={msg.kind === "ok" ? "polite" : undefined}
              className={`text-sm ${msg.kind === "ok" ? "text-income" : "text-destructive"}`}
            >
              {msg.text}
            </p>
          )}

          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={preview}>Preview PDF</Button>
            <Button type="button" onClick={send} disabled={sending || selected.size === 0}>
              {sending ? "Sending…" : "Send welcome letter"}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
