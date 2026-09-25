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

export function ReceiptSettingsSection({ settings }: { settings: ReceiptSettings }) {
  const [fields, setFields] = useState<ReceiptSettings>(settings)
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
      setFeedback("ok" in r ? { success: "Saved." } : { error: r.error })
    })
  }

  function resetAll() {
    setFeedback(undefined)
    startTransition(async () => {
      const r = await resetReceiptSettings()
      if ("error" in r) {
        setFeedback({ error: r.error })
        return
      }
      setFields(DEFAULT_RECEIPT_SETTINGS)
      setFeedback({ success: "Reset to defaults." })
    })
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Tax Receipt</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Wording used on tax-deductible donation receipts (PDF and email).
      </p>
      <div className="space-y-4 max-w-lg">
        {FIELDS.map((f) => (
          <div key={f.settingKey}>
            <Label htmlFor={f.settingKey}>{f.label}</Label>
            {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
            {f.multiline ? (
              <Textarea
                id={f.settingKey}
                value={fields[f.key]}
                rows={f.rows}
                maxLength={RECEIPT_SETTING_MAX_LENGTHS[f.settingKey]}
                disabled={pending}
                onChange={set(f.key)}
                className="mt-1"
              />
            ) : (
              <Input
                id={f.settingKey}
                value={fields[f.key]}
                maxLength={RECEIPT_SETTING_MAX_LENGTHS[f.settingKey]}
                disabled={pending}
                onChange={set(f.key)}
                className="mt-1"
              />
            )}
          </div>
        ))}
        <FormFeedback state={feedback} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="outline" onClick={resetAll} disabled={pending}>
            Reset all to defaults
          </Button>
        </div>
      </div>
    </div>
  )
}
