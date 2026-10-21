"use client"

import { updateMembershipSettings } from "@/lib/actions/settings"
import type { MembershipSettings } from "@/lib/membershipSettings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { useKeepFormValues } from "./useKeepFormValues"
import { useFormDirty } from "./unsavedChanges"
import { SettingsCard } from "./ui/SettingsCard"
import { SettingsRow } from "./ui/SettingsRow"

/**
 * Public membership form options card.
 * @param props.settings the stored membership settings
 */
export function MembershipSettingsForm({ settings }: Readonly<{ settings: MembershipSettings }>) {
  const [state, formAction, isPending, keep, keepChecked] = useKeepFormValues(updateMembershipSettings)
  const { ref } = useFormDirty()

  return (
    // key remounts the uncontrolled inputs (and the dirty baseline) when revalidated props change
    <form ref={ref} action={formAction} key={JSON.stringify(settings)}>
      <SettingsCard
        title="Membership"
        description="Public membership form options."
        footer={<Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save membership settings"}</Button>}
      >
        <SettingsRow
          label="Ask for previous church, transfer letter and spouse's church"
          htmlFor="membershipParishFields"
        >
          <input
            id="membershipParishFields"
            name="membershipParishFields"
            type="checkbox"
            defaultChecked={keepChecked("membershipParishFields", settings.parishFields)}
            className="size-4"
          />
        </SettingsRow>
        <SettingsRow
          label="Minimum monthly dues ($)"
          htmlFor="membershipMinDues"
          description="Also pre-fills dues when adding a family."
        >
          <Input
            id="membershipMinDues"
            name="membershipMinDues"
            inputMode="decimal"
            maxLength={20}
            defaultValue={keep("membershipMinDues", settings.minDues ?? "")}
            placeholder="Blank = no minimum"
            className="md:w-80"
          />
        </SettingsRow>
        <SettingsRow label="Overseas / home-country address field label" htmlFor="membershipHomeAddressLabel">
          <Input
            id="membershipHomeAddressLabel"
            name="membershipHomeAddressLabel"
            maxLength={80}
            defaultValue={keep("membershipHomeAddressLabel", settings.homeAddressLabel)}
            placeholder="Blank = don't ask (e.g. Address in India)"
            className="md:w-80"
          />
        </SettingsRow>
        <SettingsRow label="Arrival date field label" htmlFor="membershipArrivalDateLabel">
          <Input
            id="membershipArrivalDateLabel"
            name="membershipArrivalDateLabel"
            maxLength={80}
            defaultValue={keep("membershipArrivalDateLabel", settings.arrivalDateLabel)}
            placeholder="Blank = don't ask (e.g. Date of arrival in Australia)"
            className="md:w-80"
          />
        </SettingsRow>
        <FormFeedback state={state} />
      </SettingsCard>
    </form>
  )
}
