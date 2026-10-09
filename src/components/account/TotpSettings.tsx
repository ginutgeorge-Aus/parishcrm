"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"
import {
  cancelTotpEnrolment, confirmTotpEnrolment, disableTotp, regenerateBackupCodes, startTotpEnrolment,
  type TotpStatus,
} from "@/lib/actions/totp"

type Mode =
  | { kind: "idle" }
  | { kind: "enrolling"; qrDataUrl: string; manualKey: string }
  | { kind: "codes"; codes: string[] }
  | { kind: "regenerate" }
  | { kind: "disable" }

export function TotpSettings({ status }: Readonly<{ status: TotpStatus }>) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>({ kind: "idle" })
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<string>("")
  const [pending, startTransition] = useTransition()
  const codesHeadingRef = useRef<HTMLParagraphElement>(null)

  // Clicking Set up / Turn off / New backup codes unmounts the focused button;
  // move focus to the first control of the form (or the codes heading) that replaces it.
  useEffect(() => {
    if (mode.kind === "enrolling") document.getElementById("totp-confirm")?.focus()
    else if (mode.kind === "regenerate" || mode.kind === "disable") document.getElementById("totp-manage")?.focus()
    else if (mode.kind === "codes") codesHeadingRef.current?.focus()
  }, [mode.kind])

  /**
   * Copies the backup codes to the clipboard and reports the outcome in the
   * live region; fails visibly when the clipboard is unavailable or rejects.
   */
  async function copyCodes(text: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable")
      await navigator.clipboard.writeText(text)
      setCopyStatus("Copied")
    } catch {
      setCopyStatus("Could not copy. Select the codes and copy them manually.")
    }
  }

  const reset = () => { setMode({ kind: "idle" }); setCode(""); setPassword(""); setError(null) }
  const run = (fn: () => Promise<void>) => startTransition(async () => {
    setError(null)
    try {
      await fn()
    } catch {
      setError("Something went wrong. Please try again.")
    }
  })

  if (mode.kind === "codes") {
    const text = mode.codes.join("\n")
    return (
      <div className="space-y-3 rounded-md border p-4">
        <p ref={codesHeadingRef} tabIndex={-1} className="text-sm font-medium outline-none">Save your backup codes</p>
        <p className="text-sm text-muted-foreground">
          Each code signs you in once if you lose your phone. They won&apos;t be shown again.
        </p>
        <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
          {mode.codes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => copyCodes(text)}>
            Copy
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download="backup-codes.txt">Download</a>
          </Button>
          <Button size="sm" onClick={() => { reset(); router.refresh() }}>I&apos;ve saved these codes</Button>
        </div>
        <p role="status" className="text-sm text-muted-foreground">{copyStatus}</p>
      </div>
    )
  }

  if (mode.kind === "enrolling") {
    return (
      <form
        className="space-y-3 rounded-md border p-4"
        onSubmit={(e) => {
          e.preventDefault()
          run(async () => {
            const res = await confirmTotpEnrolment(code, password)
            if ("error" in res) setError(res.error)
            else { setCode(""); setPassword(""); setMode({ kind: "codes", codes: res.backupCodes }) }
          })
        }}
      >
        <p className="text-sm text-muted-foreground">
          Scan this with Google Authenticator, Microsoft Authenticator or a password manager, then enter the code it shows.
        </p>
        {/* QR codes need a white quiet zone to scan, in dark mode too */}
        {/* eslint-disable-next-line no-restricted-syntax, @next/next/no-img-element -- data: URL, nothing to optimise */}
        <img src={mode.qrDataUrl} alt="Authenticator QR code" width={192} height={192} className="rounded bg-white p-2" />
        <p className="text-xs text-muted-foreground">
          Can&apos;t scan? Enter this key: <code className="break-all font-mono">{mode.manualKey}</code>
        </p>
        <div className="space-y-2">
          <Label htmlFor="totp-confirm">Code from app</Label>
          <Input
            id="totp-confirm" inputMode="numeric" maxLength={6} required autoComplete="one-time-code"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "totp-confirm-error" : undefined}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="totp-password">Current password</Label>
          <Input
            id="totp-password" type="password" required autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <FormFeedback state={{ error }} id="totp-confirm-error" />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending}>{pending ? "Checking…" : "Turn on"}</Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { cancelTotpEnrolment().catch(() => {}); reset() }}>
            Cancel
          </Button>
        </div>
      </form>
    )
  }

  if (mode.kind === "regenerate" || mode.kind === "disable") {
    const isDisable = mode.kind === "disable"
    return (
      <form
        className="space-y-3 rounded-md border p-4"
        onSubmit={(e) => {
          e.preventDefault()
          run(async () => {
            if (isDisable) {
              const res = await disableTotp(code)
              if ("error" in res) setError(res.error)
              else { reset(); router.refresh() }
            } else {
              const res = await regenerateBackupCodes(code)
              if ("error" in res) setError(res.error)
              else { setCode(""); setMode({ kind: "codes", codes: res.backupCodes }) }
            }
          })
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="totp-manage">{isDisable ? "Authenticator or backup code" : "Code from app"}</Label>
          <Input
            id="totp-manage" required autoComplete="one-time-code"
            inputMode={isDisable ? "text" : "numeric"} maxLength={isDisable ? 11 : 6}
            value={code}
            onChange={(e) => setCode(isDisable ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ""))}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "totp-manage-error" : undefined}
          />
        </div>
        <FormFeedback state={{ error }} id="totp-manage-error" />
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant={isDisable ? "destructive" : "default"} disabled={pending}>
            {isDisable ? "Confirm turn off" : "Generate"}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset}>Cancel</Button>
        </div>
      </form>
    )
  }

  if (!status.enabled) {
    return (
      <div className="space-y-2">
        <Button
          variant="outline" size="sm" disabled={pending}
          onClick={() => run(async () => {
            const res = await startTotpEnrolment()
            if ("error" in res) setError(res.error)
            else setMode({ kind: "enrolling", qrDataUrl: res.qrDataUrl, manualKey: res.manualKey })
          })}
        >
          Set up authenticator app
        </Button>
        <FormFeedback state={{ error }} id="totp-start-error" />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-medium text-success">On.</span>{" "}
        <span className="text-muted-foreground">{status.backupCodesRemaining} of 10 backup codes left.</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setMode({ kind: "regenerate" })}>New backup codes</Button>
        <Button variant="outline" size="sm" onClick={() => setMode({ kind: "disable" })}>Turn off</Button>
      </div>
    </div>
  )
}
