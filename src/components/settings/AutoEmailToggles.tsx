"use client"

import { useState, useTransition } from "react"
import { Switch } from "@/components/ui/switch"
import { updateAutoEmailFlags } from "@/lib/actions/settings"
import { SettingsRow } from "./ui/SettingsRow"
import { SettingsSubgroup } from "./ui/SettingsSubgroup"

type Flags = { birthday: boolean; anniversary: boolean }

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
      <SettingsRow label="Send birthday blessings automatically" htmlFor="autoBirthdayEmail">
        <Switch
          id="autoBirthdayEmail"
          checked={flags.birthday}
          disabled={pending}
          onCheckedChange={(v) => save({ ...flags, birthday: v })}
        />
      </SettingsRow>
      <SettingsRow label="Send anniversary blessings automatically" htmlFor="autoAnniversaryEmail">
        <Switch
          id="autoAnniversaryEmail"
          checked={flags.anniversary}
          disabled={pending}
          onCheckedChange={(v) => save({ ...flags, anniversary: v })}
        />
      </SettingsRow>
    </SettingsSubgroup>
  )
}
