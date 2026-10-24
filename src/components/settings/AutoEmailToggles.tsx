"use client"

import { useState, useTransition } from "react"
import { Switch } from "@/components/ui/switch"
import { updateAutoEmailFlags } from "@/lib/actions/settings"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { SettingsRow, joinDescribedBy } from "./ui/SettingsRow"
import { SettingsSubgroup } from "./ui/SettingsSubgroup"

const ERROR_ID = "auto-email-error"

type Flags = { birthday: boolean; anniversary: boolean }

/**
 * One switch row whose current state reads as text (visible On/Off badge and a
 * status description), not just the switch position. The text follows the
 * last SAVED state; while this row's save is in flight it reads "Saving…".
 * @param props.id switch id
 * @param props.label row label
 * @param props.noun "Birthday" / "Anniversary", for the status line
 * @param props.on switch position (optimistic while saving)
 * @param props.saved last confirmed saved state
 * @param props.saving this row's save is in flight
 * @param props.disabled any save is in flight (switches lock)
 * @param props.hasError the shared error line is showing (linked via aria-describedby)
 * @param props.onChange called with the new state
 */
function ToggleRow({
  id, label, noun, on, saved, saving, disabled, hasError, onChange,
}: Readonly<{
  id: string
  label: string
  noun: string
  on: boolean
  saved: boolean
  saving: boolean
  disabled: boolean
  hasError: boolean
  onChange: (v: boolean) => void
}>) {
  let status: string
  if (saving) status = `Saving automatic ${noun.toLowerCase()} email setting…`
  else if (saved) status = `Automatic ${noun.toLowerCase()} emails are on (sent by the daily job).`
  else status = `Automatic ${noun.toLowerCase()} emails are off.`
  let badge: string
  if (saving) badge = "…"
  else badge = saved ? "On" : "Off"
  return (
    <SettingsRow label={label} htmlFor={id} description={status}>
      {(descId) => (
        <div className="flex items-center gap-3">
          <Switch id={id} aria-describedby={joinDescribedBy(descId, hasError && ERROR_ID)} checked={on} disabled={disabled} onCheckedChange={onChange} />
          {/* The switch already announces its state; this is the at-a-glance label. */}
          <span
            aria-hidden="true"
            className={saved && !saving ? "w-7 text-sm font-medium text-foreground" : "w-7 text-sm text-muted-foreground"}
          >
            {badge}
          </span>
        </div>
      )}
    </SettingsRow>
  )
}

// A Radix Switch renders a <button role="switch">, which does NOT post to
// FormData in a plain form. Rather than shadow it with a hidden input, move
// the switch optimistically and call the server action with a JS-built
// FormData. The On/Off text only follows the saved state; on error the switch
// reverts and the reason stays visible (role="alert") until the next attempt.
/**
 * Instant-save switches for the daily blessing-email jobs; reverts on error.
 * @param props.birthday birthday emails currently on
 * @param props.anniversary anniversary emails currently on
 */
export function AutoEmailToggles({ birthday, anniversary }: Readonly<Flags>) {
  const [flags, setFlags] = useState<Flags>({ birthday, anniversary })
  const [saved, setSaved] = useState<Flags>({ birthday, anniversary })
  const [saving, setSaving] = useState<keyof Flags | null>(null)
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ error?: string; success?: string } | undefined>()

  /**
   * Saves `next` for the toggled `key`; commits it as the saved state only on success.
   * @param key which flag changed
   * @param next the full flag set to save
   */
  const save = (key: keyof Flags, next: Flags) => {
    setFlags(next)
    setSaving(key)
    setFeedback(undefined)
    startTransition(async () => {
      // Send only the toggled key: a stale snapshot of the other switch must never overwrite it.
      const fd = new FormData()
      const field = key === "birthday" ? "autoBirthdayEmail" : "autoAnniversaryEmail"
      fd.set("only", field)
      fd.set(field, next[key] ? "true" : "false")
      try {
        const res = await updateAutoEmailFlags(undefined, fd)
        if (res && "error" in res) {
          // Resync from the persisted values when the server could read them (a write may have committed); else revert.
          const truth = res.flags ?? saved
          setFlags(truth)
          setSaved(truth)
          setFeedback({ error: res.error })
        } else {
          setSaved((s) => ({ ...s, [key]: next[key] }))
          setFeedback({ success: "Saved" })
        }
      } catch {
        // No response: the write may still have committed, so don't claim it failed.
        setFlags(saved)
        setFeedback({ error: "Couldn't confirm the save. Reload the page to see the current setting." })
      } finally {
        setSaving(null)
      }
    })
  }

  return (
    <SettingsSubgroup
      title="Automated blessing emails"
      description="When on, a daily job emails each member their birthday or anniversary blessing automatically, consent-gated, using the templates below. Leave off to send manually from the People pages."
    >
      <FormFeedback id={ERROR_ID} state={feedback} className="py-3" />
      <ToggleRow
        id="autoBirthdayEmail"
        label="Send birthday blessings automatically"
        noun="Birthday"
        on={flags.birthday}
        saved={saved.birthday}
        saving={saving === "birthday"}
        disabled={pending}
        hasError={!!feedback?.error}
        onChange={(v) => save("birthday", { ...flags, birthday: v })}
      />
      <ToggleRow
        id="autoAnniversaryEmail"
        label="Send anniversary blessings automatically"
        noun="Anniversary"
        on={flags.anniversary}
        saved={saved.anniversary}
        saving={saving === "anniversary"}
        disabled={pending}
        hasError={!!feedback?.error}
        onChange={(v) => save("anniversary", { ...flags, anniversary: v })}
      />
    </SettingsSubgroup>
  )
}
