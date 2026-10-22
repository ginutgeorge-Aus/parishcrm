"use client"

import { updateLetterSettings } from "@/lib/actions/settings"
import type { LetterSettings } from "@/lib/letterSettings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { useKeepFormValues } from "./useKeepFormValues"
import { useFormDirty } from "./unsavedChanges"
import { SettingsCard } from "./ui/SettingsCard"
import { SettingsRow } from "./ui/SettingsRow"
import { SettingsSubgroup } from "./ui/SettingsSubgroup"

/**
 * Welcome-letter settings card: bank accounts, default signer and wording.
 * @param props.settings the stored letter settings
 */
export function LetterSettingsForm({ settings }: Readonly<{ settings: LetterSettings }>) {
  const [state, formAction, isPending, keep] = useKeepFormValues(updateLetterSettings)
  const { ref } = useFormDirty(state)

  /** One single-line text setting as a row. */
  const field = (name: string, label: string, def: string) => (
    <SettingsRow key={name} label={label} htmlFor={name}>
      <Input id={name} name={name} type="text" defaultValue={keep(name, def)} className="md:w-80" maxLength={120} />
    </SettingsRow>
  )

  return (
    // key remounts the uncontrolled inputs (and the dirty baseline) when revalidated props change
    <form ref={ref} action={formAction} key={JSON.stringify([settings.general.bank, settings.general.bsb, settings.general.account, settings.general.accountName, settings.building.bank, settings.building.bsb, settings.building.account, settings.building.accountName, settings.signerName, settings.signerTitle, settings.general.fundLabel, settings.building.fundLabel, settings.introTemplate, settings.contributionsTemplate, settings.closingTemplate])}>
      <SettingsCard
        title="Welcome letter"
        description="Bank accounts, default signer and wording of the new-member welcome letter."
        footer={<Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save welcome letter settings"}</Button>}
      >
        <SettingsSubgroup title={settings.general.fundLabel}>
          {field("bankGeneralFundLabel", "Fund label", settings.general.fundLabel)}
          {field("bankGeneralBank", "Bank", settings.general.bank)}
          {field("bankGeneralBsb", "BSB", settings.general.bsb)}
          {field("bankGeneralAccount", "Account Number", settings.general.account)}
          {field("bankGeneralAccountName", "Account Name", settings.general.accountName)}
        </SettingsSubgroup>
        <SettingsSubgroup title={settings.building.fundLabel} description="Tax deductible.">
          {field("bankBuildingFundLabel", "Fund label", settings.building.fundLabel)}
          {field("bankBuildingBank", "Bank", settings.building.bank)}
          {field("bankBuildingBsb", "BSB", settings.building.bsb)}
          {field("bankBuildingAccount", "Account Number", settings.building.account)}
          {field("bankBuildingAccountName", "Account Name", settings.building.accountName)}
        </SettingsSubgroup>
        <SettingsSubgroup title="Signer">
          {field("letterSignerName", "Default signer name", settings.signerName)}
          {field("letterSignerTitle", "Default signer title", settings.signerTitle)}
        </SettingsSubgroup>
        {([
          ["letterIntro", "Intro paragraphs", settings.introTemplate],
          ["letterContributions", "Contributions paragraph (above bank details)", settings.contributionsTemplate],
          ["letterClosing", "Closing paragraph", settings.closingTemplate],
        ] as const).map(([name, lbl, def]) => (
          <div key={name} className="space-y-2 py-5">
            <Label htmlFor={name}>{lbl}</Label>
            <Textarea id={name} name={name} defaultValue={keep(name, def)} rows={5} maxLength={4000} placeholder="Blank = default text" />
          </div>
        ))}
        <p className="py-4 text-xs text-muted-foreground">
          Separate paragraphs with a blank line. Placeholders: {"{churchName}"}, {"{memberNo}"}. The enrolment sentence is added
          automatically after the first intro paragraph.
        </p>
        <FormFeedback state={state} />
      </SettingsCard>
    </form>
  )
}
