"use client"

import { upsertSetting } from "@/lib/actions/settings"
import { IDLE_TIMEOUT_OPTIONS_LIST } from "@/lib/settingsConstants"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { APP_CURRENCY } from "@/lib/appConfig"
import { useKeepFormValues } from "./useKeepFormValues"
import { useFormDirty } from "./unsavedChanges"
import { SettingsCard } from "./ui/SettingsCard"
import { SettingsRow, settingsDescId } from "./ui/SettingsRow"

type Props = {
  ownerNotificationEmail: string
  membershipSecretaryEmail: string
  idleTimeoutMinutes: number
  cardFeePercent: string
  cardFeeFixed: string
  /** Membership Applications row (Membership forms on). Default true. */
  showMembership?: boolean
  /** Card Processing Fee rows (Events on). Default true. */
  showCardFee?: boolean
}

type KeepFn = (name: string, fallback: string) => string

/**
 * One app setting saved on its own: a `<form>` holding one `SettingsRow` whose
 * control is the input plus an inline Save button. Owns its dirty tracking.
 * @param props.settingKey the AppSetting key posted as the hidden `key` field
 * @param props.label row label
 * @param props.description row helper text
 * @param props.htmlFor id of the control inside `control`
 * @param props.control renders the input(s); receives the keep-values helper
 */
function SettingRow({
  settingKey, label, description, htmlFor, control,
}: Readonly<{
  settingKey: string
  label: string
  description: React.ReactNode
  htmlFor: string
  control: (keep: KeepFn) => React.ReactNode
}>) {
  const [state, formAction, isPending, keep] = useKeepFormValues(upsertSetting)
  const { ref } = useFormDirty(state)
  return (
    <form ref={ref} action={formAction}>
      <input type="hidden" name="key" value={settingKey} />
      <SettingsRow label={label} description={description} htmlFor={htmlFor}>
        <div className="flex gap-2">
          {control(keep)}
          <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save"}</Button>
        </div>
        <FormFeedback state={state} />
      </SettingsRow>
    </form>
  )
}

/**
 * General app settings: owner alert email, membership alert email, idle
 * timeout and card fee. Feature-owned rows hide while their feature is off.
 * Each setting saves on its own.
 * @param props the current saved values and feature gates
 */
export function AppSettingsForm({
  ownerNotificationEmail, membershipSecretaryEmail, idleTimeoutMinutes, cardFeePercent, cardFeeFixed,
  showMembership = true, showCardFee = true,
}: Readonly<Props>) {
  return (
    <SettingsCard title="App settings" description="Alerts, sign-out timing and fees. Each setting saves on its own.">
      <SettingRow
        settingKey="ownerNotificationEmail"
        label="Notification email address"
        htmlFor="owner-email"
        description="Receives failed-login alerts, public feedback messages, email-delivery-failure alerts and Stripe payment alerts. Leave blank to disable notifications."
        control={(keep) => (
          <Input
            id="owner-email"
            aria-describedby={settingsDescId("owner-email")}
            name="value"
            type="email"
            defaultValue={keep("value", ownerNotificationEmail)}
            placeholder="owner@example.com"
            className="md:w-64"
          />
        )}
      />
      {showMembership && (
        <SettingRow
          settingKey="membershipSecretaryEmail"
          label="Secretary email address(es)"
          htmlFor="membership-email"
          description="Where to email an alert when a new public membership application arrives. Separate multiple addresses with commas. Leave blank to fall back to the church email."
          control={(keep) => (
            <Input
              id="membership-email"
              aria-describedby={settingsDescId("membership-email")}
              name="value"
              type="text"
              defaultValue={keep("value", membershipSecretaryEmail)}
              placeholder="secretary@example.com, admin@example.com"
              className="md:w-64"
            />
          )}
        />
      )}
      <SettingRow
        settingKey="SESSION_IDLE_TIMEOUT_MINUTES"
        label="Idle timeout"
        htmlFor="idle-timeout"
        description="Automatically sign out inactive users after this period."
        control={(keep) => {
          const value = keep("value", String(idleTimeoutMinutes))
          // Keyed: a select's default only applies on mount, so remount to show the kept choice after the form reset
          return (
            <Select key={value} name="value" defaultValue={value}>
              <SelectTrigger id="idle-timeout" aria-describedby={settingsDescId("idle-timeout")} className="w-full md:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IDLE_TIMEOUT_OPTIONS_LIST.map((m) => (
                  <SelectItem key={m} value={String(m)}>{m} minutes</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }}
      />
      {showCardFee && (
        <>
          <SettingRow
            settingKey="cardFeePercent"
            label="Card processing fee: percent (%)"
            htmlFor="card-fee-percent"
            description="The blended Stripe fee used to gross up paid-event totals when an event opts to pass the card fee to the registrant. Update when Stripe changes its pricing."
            control={(keep) => (
              <Input
                id="card-fee-percent"
                aria-describedby={settingsDescId("card-fee-percent")}
                name="value"
                type="number"
                step="0.01"
                min={0}
                max={10}
                defaultValue={keep("value", cardFeePercent)}
                placeholder="1.7"
                className="md:w-32"
              />
            )}
          />
          <SettingRow
            settingKey="cardFeeFixed"
            label={`Card processing fee: fixed (${APP_CURRENCY})`}
            htmlFor="card-fee-fixed"
            description="The fixed part of the card fee, added to each card payment."
            control={(keep) => (
              <Input
                id="card-fee-fixed"
                aria-describedby={settingsDescId("card-fee-fixed")}
                name="value"
                type="number"
                step="0.01"
                min={0}
                max={5}
                defaultValue={keep("value", cardFeeFixed)}
                placeholder="0.30"
                className="md:w-32"
              />
            )}
          />
        </>
      )}
    </SettingsCard>
  )
}
