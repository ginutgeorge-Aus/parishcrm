"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { startRegistration } from "@simplewebauthn/browser"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { finishPasskeyRegistration, removePasskey, startPasskeyRegistration, type PasskeyStatus } from "@/lib/actions/passkey"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"

/**
 * Formats a Date object as a locale-specific date string.
 * @param {Date} d - The date to format.
 * @returns {string} The formatted date string.
 */
const fmt = (d: Date) => new Date(d).toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE })

/**
 * Component for managing passkey settings, including registration and removal.
 * @param {object} props - The props for the component.
 * @param {PasskeyStatus} props.status - Current passkey status.
 * @returns {JSX.Element} The passkey settings component.
 */
export function PasskeySettings({ status }: Readonly<{ status: PasskeyStatus }>) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("Passkey")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  // Only a wrong password marks the password field invalid (not a cancelled prompt, bad name…).
  const [passwordInvalid, setPasswordInvalid] = useState(false)
  const [pending, startTransition] = useTransition()

  // "Add a passkey" unmounts the focused button; land on the form's first field.
  useEffect(() => {
    if (adding) document.getElementById("passkey-name")?.focus()
  }, [adding])

  /**
   * Resets the passkey form state to default values.
   */
  const reset = () => { setAdding(false); setName("Passkey"); setPassword(""); setError(null); setPasswordInvalid(false) }

  /**
   * Initiates the passkey registration process, handling UI state and server interactions.
   */
  function add() {
    setError(null)
    setPasswordInvalid(false)
    startTransition(async () => {
      try {
        const start = await startPasskeyRegistration(password)
        if ("error" in start) {
          setError(start.error)
          setPasswordInvalid(start.error === "Incorrect password")
          return
        }
        const attestation = await startRegistration({ optionsJSON: start.options })
        const res = await finishPasskeyRegistration(start.challengeId, attestation, name)
        if ("error" in res) { setError(res.error); return }
        reset()
        router.refresh()
      } catch (e) {
        // NotAllowedError = the user dismissed the browser/OS prompt (or it timed out).
        setError(e instanceof Error && e.name === "NotAllowedError" ? "Passkey setup was cancelled." : "Something went wrong. Please try again.")
      }
    })
  }

  /**
   * Removes a passkey by its identifier and refreshes the UI.
   * @param {string} id - The identifier of the passkey to remove.
   */
  function remove(id: string) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await removePasskey(id)
        if ("error" in res) { setError(res.error); return }
        router.refresh()
      } catch {
        setError("Something went wrong. Please try again.")
      }
    })
  }

  return (
    <div className="space-y-3">
      {/* Existing passkeys stay listed (and removable) even when new ones can't be added. */}
      {!status.available && (
        <p className="text-sm text-muted-foreground">Passkeys need this site to be served over HTTPS.</p>
      )}
      {status.passkeys.length > 0 && (
        <ul className="divide-y divide-border rounded-md border">
          {status.passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-4 p-3">
              <div className="min-w-0">
                <p className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                  <span className="truncate">{p.name}</span>
                  {p.backedUp && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Synced</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Added {fmt(p.createdAt)} · {p.lastUsedAt ? `Last used ${fmt(p.lastUsedAt)}` : "Never used"}
                </p>
              </div>
              <Button variant="outline" size="sm" disabled={pending} aria-label={`Remove ${p.name}`} onClick={() => remove(p.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form
          className="space-y-3 rounded-md border p-4"
          onSubmit={(e) => { e.preventDefault(); add() }}
        >
          <div className="space-y-2">
            <Label htmlFor="passkey-name">Passkey name</Label>
            <Input
              id="passkey-name" required maxLength={50}
              value={name} onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="passkey-password">Current password</Label>
            <Input
              id="passkey-password" type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              aria-invalid={passwordInvalid ? true : undefined}
              aria-describedby={passwordInvalid ? "passkey-error" : undefined}
            />
          </div>
          <FormFeedback state={{ error }} id="passkey-error" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>{pending ? "Waiting for device…" : "Create passkey"}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset}>Cancel</Button>
          </div>
        </form>
      ) : (
        <>
          {status.available && status.passkeys.length < status.limit && (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setAdding(true)}>
              Add a passkey
            </Button>
          )}
          <FormFeedback state={{ error }} id="passkey-error" />
        </>
      )}
    </div>
  )
}
