"use client"

import { useActionState } from "react"
import { updateLetterSettings } from "@/lib/actions/settings"
import type { LetterSettings } from "@/lib/letterSettings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { FormFeedback } from "@/components/ui/FormFeedback"

export function LetterSettingsForm({ settings }: { settings: LetterSettings }) {
  const [state, formAction, isPending] = useActionState(updateLetterSettings, undefined)

  const field = (name: string, label: string, def: string) => (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="text" defaultValue={def} className="mt-1" maxLength={120} />
    </div>
  )

  return (
    <section>
      <h3 className="text-base font-semibold text-foreground mb-1">Welcome Letter</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Bank accounts, default signer and wording of the new-member welcome letter.
      </p>
      <form action={formAction} className="space-y-4" key={JSON.stringify([settings.general.bank, settings.general.bsb, settings.general.account, settings.general.accountName, settings.building.bank, settings.building.bsb, settings.building.account, settings.building.accountName, settings.signerName, settings.signerTitle, settings.general.fundLabel, settings.building.fundLabel, settings.introTemplate, settings.contributionsTemplate, settings.closingTemplate])}>
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{settings.general.fundLabel}</legend>
            {field("bankGeneralFundLabel", "Fund label", settings.general.fundLabel)}
            {field("bankGeneralBank", "Bank", settings.general.bank)}
            {field("bankGeneralBsb", "BSB", settings.general.bsb)}
            {field("bankGeneralAccount", "Account Number", settings.general.account)}
            {field("bankGeneralAccountName", "Account Name", settings.general.accountName)}
          </fieldset>
          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{settings.building.fundLabel} (Tax Deductible)</legend>
            {field("bankBuildingFundLabel", "Fund label", settings.building.fundLabel)}
            {field("bankBuildingBank", "Bank", settings.building.bank)}
            {field("bankBuildingBsb", "BSB", settings.building.bsb)}
            {field("bankBuildingAccount", "Account Number", settings.building.account)}
            {field("bankBuildingAccountName", "Account Name", settings.building.accountName)}
          </fieldset>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("letterSignerName", "Default signer name", settings.signerName)}
          {field("letterSignerTitle", "Default signer title", settings.signerTitle)}
        </div>
        {([
          ["letterIntro", "Intro paragraphs", settings.introTemplate],
          ["letterContributions", "Contributions paragraph (above bank details)", settings.contributionsTemplate],
          ["letterClosing", "Closing paragraph", settings.closingTemplate],
        ] as const).map(([name, lbl, def]) => (
          <div key={name}>
            <Label htmlFor={name}>{lbl}</Label>
            <Textarea id={name} name={name} defaultValue={def} rows={5} maxLength={4000} className="mt-1" placeholder="Blank = default text" />
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Separate paragraphs with a blank line. Placeholders: {"{churchName}"}, {"{memberNo}"}. The enrolment sentence is added
          automatically after the first intro paragraph.
        </p>
        <FormFeedback state={state} />
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save welcome letter settings"}</Button>
      </form>
    </section>
  )
}
