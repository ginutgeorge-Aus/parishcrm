"use client"

import { useActionState } from "react"
import { upsertSetting } from "@/lib/actions/settings"
import { IDLE_TIMEOUT_OPTIONS_LIST } from "@/lib/settingsConstants"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { APP_CURRENCY } from "@/lib/appConfig"

type Props = {
  ownerNotificationEmail: string
  membershipSecretaryEmail: string
  idleTimeoutMinutes: number
  cardFeePercent: string
  cardFeeFixed: string
}

export function AppSettingsForm({ ownerNotificationEmail, membershipSecretaryEmail, idleTimeoutMinutes, cardFeePercent, cardFeeFixed }: Props) {
  const [state, formAction, isPending] = useActionState(upsertSetting, undefined)
  const [membershipState, membershipFormAction, isMembershipPending] = useActionState(upsertSetting, undefined)
  const [idleState, idleFormAction, isIdlePending] = useActionState(upsertSetting, undefined)
  const [pctState, pctFormAction, isPctPending] = useActionState(upsertSetting, undefined)
  const [fixedState, fixedFormAction, isFixedPending] = useActionState(upsertSetting, undefined)

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-base font-semibold text-foreground mb-1">Login Notifications</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Receive an email whenever a failed login attempt is recorded.
        </p>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="key" value="ownerNotificationEmail" />
          <div>
            <Label htmlFor="owner-email">Notification email address</Label>
            <Input
              id="owner-email"
              name="value"
              type="email"
              defaultValue={ownerNotificationEmail}
              placeholder="owner@example.com"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">Leave blank to disable notifications.</p>
          </div>
          <FormFeedback state={state} />
          <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save"}</Button>
        </form>
      </section>
      <section>
        <h3 className="text-base font-semibold text-foreground mb-1">Membership Applications</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Where to email an alert when a new public membership application arrives.
        </p>
        <form action={membershipFormAction} className="space-y-3">
          <input type="hidden" name="key" value="membershipSecretaryEmail" />
          <div>
            <Label htmlFor="membership-email">Secretary email address(es)</Label>
            <Input
              id="membership-email"
              name="value"
              type="text"
              defaultValue={membershipSecretaryEmail}
              placeholder="secretary@example.com, admin@example.com"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Separate multiple addresses with commas. Leave blank to fall back to the church email.
            </p>
          </div>
          <FormFeedback state={membershipState} />
          <Button type="submit" disabled={isMembershipPending}>{isMembershipPending ? "Saving…" : "Save"}</Button>
        </form>
      </section>
      <section>
        <h3 className="text-base font-semibold text-foreground mb-1">Session Timeout</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Automatically sign out inactive users after this period.
        </p>
        <form action={idleFormAction} className="space-y-3">
          <input type="hidden" name="key" value="SESSION_IDLE_TIMEOUT_MINUTES" />
          <div>
            <Label htmlFor="idle-timeout">Idle timeout</Label>
            <Select name="value" defaultValue={String(idleTimeoutMinutes)}>
              <SelectTrigger id="idle-timeout" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IDLE_TIMEOUT_OPTIONS_LIST.map((m) => (
                  <SelectItem key={m} value={String(m)}>{m} minutes</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FormFeedback state={idleState} />
          <Button type="submit" disabled={isIdlePending}>{isIdlePending ? "Saving…" : "Save"}</Button>
        </form>
      </section>
      <section>
        <h3 className="text-base font-semibold text-foreground mb-1">Card Processing Fee</h3>
        <p className="text-sm text-muted-foreground mb-4">
          The blended Stripe fee used to gross up paid-event totals when an event
          opts to pass the card fee to the registrant. Update when Stripe changes
          its pricing.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <form action={pctFormAction} className="space-y-3">
            <input type="hidden" name="key" value="cardFeePercent" />
            <div>
              <Label htmlFor="card-fee-percent">Percent (%)</Label>
              <Input
                id="card-fee-percent"
                name="value"
                type="number"
                step="0.01"
                min={0}
                max={10}
                defaultValue={cardFeePercent}
                placeholder="1.7"
                className="mt-1"
              />
            </div>
            <FormFeedback state={pctState} />
            <Button type="submit" disabled={isPctPending}>{isPctPending ? "Saving…" : "Save"}</Button>
          </form>
          <form action={fixedFormAction} className="space-y-3">
            <input type="hidden" name="key" value="cardFeeFixed" />
            <div>
              <Label htmlFor="card-fee-fixed">Fixed ({APP_CURRENCY})</Label>
              <Input
                id="card-fee-fixed"
                name="value"
                type="number"
                step="0.01"
                min={0}
                max={5}
                defaultValue={cardFeeFixed}
                placeholder="0.30"
                className="mt-1"
              />
            </div>
            <FormFeedback state={fixedState} />
            <Button type="submit" disabled={isFixedPending}>{isFixedPending ? "Saving…" : "Save"}</Button>
          </form>
        </div>
      </section>
    </div>
  )
}
