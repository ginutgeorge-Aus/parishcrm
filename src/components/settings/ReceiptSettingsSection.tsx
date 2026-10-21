"use client"

import * as React from "react"
import { useState, useTransition } from "react"
import { updateReceiptSettings, resetReceiptSettings } from "@/lib/actions/receiptSettings"
import {
  DEFAULT_RECEIPT_SETTINGS,
  RECEIPT_SETTING_MAX_LENGTHS,
  type ReceiptSettingKey,
  type ReceiptSettings,
} from "@/lib/receiptSettingsShared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { useUnsavedGuard } from "./unsavedChanges"
import { SettingsCard } from "./ui/SettingsCard"
import { SettingsRow } from "./ui/SettingsRow"

// Maps each editable ReceiptSettings field to its AppSetting key (what the
// server actions expect) plus display metadata.
type FieldConfig = {
  key: keyof ReceiptSettings
  settingKey: ReceiptSettingKey
  label: string
  multiline?: boolean
  rows?: number
  hint?: string
}

const FIELDS: FieldConfig[] = [
  { key: "numberPrefix", settingKey: "receiptNumberPrefix", label: "Receipt number prefix" },
  { key: "documentTitle", settingKey: "receiptDocumentTitle", label: "Receipt heading" },
  { key: "totalLabel", settingKey: "receiptTotalLabel", label: "Total label" },
  {
    key: "coveredPeriodTemplate",
    settingKey: "receiptCoveredPeriod",
    label: "Covered-period sentence",
    multiline: true,
    rows: 2,
    hint: "Vars: {from} {to}",
  },
  {
    key: "legalText",
    settingKey: "receiptLegalText",
    label: "Legal text (blank line = new paragraph)",
    multiline: true,
    rows: 6,
    hint: "Vars: {churchName}",
  },
]

/**
 * Tax receipt wording card. Saves via the footer button; warns about unsaved edits.
 * @param props.settings the stored receipt settings
 */
export function ReceiptSettingsSection({ settings }: Readonly<{ settings: ReceiptSettings }>) {
  const [fields, setFields] = useState<ReceiptSettings>(settings)
  // After a save/reset revalidates, adopt the stored values (a blank field comes
  // back as its default) so the form is clean against what was actually saved.
  const settingsJson = JSON.stringify(settings)
  const [seenSettings, setSeenSettings] = useState(settingsJson)
  if (settingsJson !== seenSettings) {
    setSeenSettings(settingsJson)
    setFields(settings)
  }
  const [feedback, setFeedback] = useState<{ error?: string; success?: string } | undefined>()
  const [pending, startTransition] = useTransition()

  const set =
    (key: keyof ReceiptSettings) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setFields((f) => ({ ...f, [key]: e.target.value }))

  function save() {
    setFeedback(undefined)
    startTransition(async () => {
      const payload: Record<string, string> = {}
      for (const f of FIELDS) payload[f.settingKey] = fields[f.key]
      const r = await updateReceiptSettings(payload)
      if ("ok" in r) {
        // The server reader maps a blank field back to its default, so show (and
        // baseline against) that effective value even when revalidated props are unchanged.
        setFields((cur) => {
          const next = { ...cur }
          for (const f of FIELDS) if (!next[f.key].trim()) next[f.key] = DEFAULT_RECEIPT_SETTINGS[f.key]
          return next
        })
      }
      setFeedback("ok" in r ? { success: "Saved." } : { error: r.error })
    })
  }

  /**
   * Resets every receipt setting to its default. Runs inside the confirm dialog;
   * returns `{ error }` so the dialog stays open and shows the message.
   */
  async function resetAll(): Promise<{ error?: string }> {
    setFeedback(undefined)
    const r = await resetReceiptSettings()
    if ("error" in r) return { error: r.error }
    setFields(DEFAULT_RECEIPT_SETTINGS)
    setFeedback({ success: "Reset to defaults." })
    return {}
  }

  const dirty = JSON.stringify(fields) !== JSON.stringify(settings)
  useUnsavedGuard(dirty)

  return (
    <SettingsCard
      title="Tax receipt"
      description="Wording used on tax-deductible donation receipts (PDF and email)."
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <DeleteConfirmButton
            onConfirm={resetAll}
            disabled={pending}
            title="Reset receipt wording to defaults?"
            description="This replaces your custom receipt text, including the legal text, with the defaults and saves immediately. This cannot be undone."
            triggerLabel="Reset all to defaults"
            triggerVariant="outline"
            triggerSize="default"
            triggerClassName=""
            confirmLabel="Reset"
            pendingLabel="Resetting…"
          />
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      {FIELDS.map((f) =>
        f.multiline ? (
          <div key={f.settingKey} className="space-y-2 py-5">
            <Label htmlFor={f.settingKey}>{f.label}</Label>
            {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
            <Textarea
              id={f.settingKey}
              value={fields[f.key]}
              rows={f.rows}
              maxLength={RECEIPT_SETTING_MAX_LENGTHS[f.settingKey]}
              disabled={pending}
              onChange={set(f.key)}
            />
          </div>
        ) : (
          <SettingsRow key={f.settingKey} label={f.label} htmlFor={f.settingKey} description={f.hint}>
            <Input
              id={f.settingKey}
              value={fields[f.key]}
              maxLength={RECEIPT_SETTING_MAX_LENGTHS[f.settingKey]}
              disabled={pending}
              onChange={set(f.key)}
              className="md:w-80"
            />
          </SettingsRow>
        ),
      )}
      <FormFeedback state={feedback} />
    </SettingsCard>
  )
}
