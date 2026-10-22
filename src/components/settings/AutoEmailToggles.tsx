"use client"

import { useState, useTransition } from "react"
import { Switch } from "@/components/ui/switch"
import { updateAutoEmailFlags } from "@/lib/actions/settings"
import { SettingsRow, settingsDescId } from "./ui/SettingsRow"
import { SettingsSubgroup } from "./ui/SettingsSubgroup"

type Flags = { birthday: boolean; anniversary: boolean }

/**
 * One switch row whose current state reads as text (visible On/Off badge and a
 * status description), not just the switch position.
 * @param props.id switch id
 * @param props.label row label
 * @param props.noun "Birthday" / "Anniversary", for the status line
 * @param props.on current state
 * @param props.pending a save is in flight
 * @param props.onChange called with the new state
 */
function ToggleRow({
  id, label, noun, on, pending, onChange,
}: Readonly<{ id: string; label: string; noun: string; on: boolean; pending: boolean; onChange: (v: boolean) => void }>) {
  return (
    <SettingsRow
      label={label}
      htmlFor={id}
      description={
        on
          ? `${noun} emails are sent automatically each day.`
          : `${noun} emails are not sent automatically.`
      }
    >
      <div className="flex items-center gap-3">
        <Switch id={id} aria-describedby={settingsDescId(id)} checked={on} disabled={pending} onCheckedChange={onChange} />
        {/* The switch already announces its state; this is the at-a-glance label. */}
        <span aria-hidden="true" className={on ? "w-7 text-sm font-medium text-foreground" : "w-7 text-sm text-muted-foreground"}>
          {on ? "On" : "Off"}
        </span>
      </div>
    </SettingsRow>
  )
}

// A Radix Switch renders a <button role="switch">, which does NOT post to
// FormData in a plain form. Rather than shadow it with a hidden input, toggle
// optimistically and call the server action with a JS-built FormData (mirrors
// the app's optimistic inline-toggle pattern). On error we revert the switch.
/**
 * Instant-save switches for the daily blessing-email jobs; reverts on error.
 * @param props.birthday birthday emails currently on
 * @param props.anniversary anniversary emails currently on
 */
export function AutoEmailToggles({ birthday, anniversary }: Readonly<Flags>) {
  const [flags, setFlags] = useState<Flags>({ birthday, anniversary })
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  const save = (next: Flags) => {
    const prev = flags
    setFlags(next)
    setMessage(null)
    startTransition(async () => {
      const fd = new FormData()
      if (next.birthday) fd.set("autoBirthdayEmail", "true")
      if (next.anniversary) fd.set("autoAnniversaryEmail", "true")
      const res = await updateAutoEmailFlags(undefined, fd)
      if (res && "error" in res) {
        setFlags(prev)
        setMessage(res.error)
      } else {
        setMessage("Saved")
      }
    })
  }

  return (
    <SettingsSubgroup
      title="Automated blessing emails"
      description="When on, a daily job emails each member their birthday or anniversary blessing automatically, consent-gated, using the templates below. Leave off to send manually from the People pages."
    >
      {message && (
        <p role="status" aria-live="polite" className="py-3 text-sm">
          {message}
        </p>
      )}
      <ToggleRow
        id="autoBirthdayEmail"
        label="Send birthday blessings automatically"
        noun="Birthday"
        on={flags.birthday}
        pending={pending}
        onChange={(v) => save({ ...flags, birthday: v })}
      />
      <ToggleRow
        id="autoAnniversaryEmail"
        label="Send anniversary blessings automatically"
        noun="Anniversary"
        on={flags.anniversary}
        pending={pending}
        onChange={(v) => save({ ...flags, anniversary: v })}
      />
    </SettingsSubgroup>
  )
}
