"use client"

import { updateMembershipSettings } from "@/lib/actions/settings"
import type { MembershipSettings } from "@/lib/membershipSettings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { useKeepFormValues } from "./useKeepFormValues"

export function MembershipSettingsForm({ settings }: Readonly<{ settings: MembershipSettings }>) {
  const [state, formAction, isPending, keep, keepChecked] = useKeepFormValues(updateMembershipSettings)

  return (
    <section>
      <h3 className="text-base font-semibold text-foreground mb-1">Membership</h3>
      <p className="text-sm text-muted-foreground mb-4">Public membership form options.</p>
      <form action={formAction} className="space-y-4" key={JSON.stringify(settings)}>
        <div className="flex items-start gap-2">
          <input
            id="membershipParishFields"
            name="membershipParishFields"
            type="checkbox"
            defaultChecked={keepChecked("membershipParishFields", settings.parishFields)}
            className="mt-1 size-4"
          />
          <Label htmlFor="membershipParishFields" className="font-normal">
            Ask for previous church, transfer letter and spouse&apos;s church
          </Label>
        </div>
        <div>
          <Label htmlFor="membershipMinDues">Minimum monthly dues ($)</Label>
          <Input
            id="membershipMinDues"
            name="membershipMinDues"
            inputMode="decimal"
            maxLength={20}
            defaultValue={keep("membershipMinDues", settings.minDues ?? "")}
            placeholder="Blank = no minimum"
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">Also pre-fills dues when adding a family.</p>
        </div>
        <div>
          <Label htmlFor="membershipHomeAddressLabel">Overseas / home-country address field label</Label>
          <Input
            id="membershipHomeAddressLabel"
            name="membershipHomeAddressLabel"
            maxLength={80}
            defaultValue={keep("membershipHomeAddressLabel", settings.homeAddressLabel)}
            placeholder="Blank = don't ask (e.g. Address in India)"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="membershipArrivalDateLabel">Arrival date field label</Label>
          <Input
            id="membershipArrivalDateLabel"
            name="membershipArrivalDateLabel"
            maxLength={80}
            defaultValue={keep("membershipArrivalDateLabel", settings.arrivalDateLabel)}
            placeholder="Blank = don't ask (e.g. Date of arrival in Australia)"
            className="mt-1"
          />
        </div>
        <FormFeedback state={state} />
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save membership settings"}</Button>
      </form>
    </section>
  )
}
