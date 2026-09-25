"use client"

import { useState, useTransition } from "react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { updateAutoEmailFlags } from "@/lib/actions/settings"

type Flags = { birthday: boolean; anniversary: boolean }

// A Radix Switch renders a <button role="switch">, which does NOT post to
// FormData in a plain form. Rather than shadow it with a hidden input, toggle
// optimistically and call the server action with a JS-built FormData (mirrors
// the app's optimistic inline-toggle pattern). On error we revert the switch.
export function AutoEmailToggles({ birthday, anniversary }: Flags) {
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
    <div className="max-w-lg space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Automated blessing emails</h3>
        <p className="text-sm text-muted-foreground">
          When on, a daily job emails each member their birthday or anniversary blessing automatically —
          consent-gated, using the templates above. Leave off to send manually from the People pages.
        </p>
      </div>
      {message && (
        <p role="status" aria-live="polite" className="text-sm">
          {message}
        </p>
      )}
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="autoBirthdayEmail" className="font-normal">
          Send birthday blessings automatically
        </Label>
        <Switch
          id="autoBirthdayEmail"
          checked={flags.birthday}
          disabled={pending}
          onCheckedChange={(v) => save({ ...flags, birthday: v })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="autoAnniversaryEmail" className="font-normal">
          Send anniversary blessings automatically
        </Label>
        <Switch
          id="autoAnniversaryEmail"
          checked={flags.anniversary}
          disabled={pending}
          onCheckedChange={(v) => save({ ...flags, anniversary: v })}
        />
      </div>
    </div>
  )
}
