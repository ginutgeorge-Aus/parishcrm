"use client"

import { useActionState } from "react"
import { updateChurchInfo } from "@/lib/actions/settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { DEFAULT_CHURCH_NAME } from "@/lib/settingsConstants"

type Props = {
  churchName: string
  churchAddress: string
  churchABN: string
  churchEmail: string
  churchWebsite: string
}

export function ChurchInfoForm({ churchName, churchAddress, churchABN, churchEmail, churchWebsite }: Props) {
  const [state, formAction, isPending] = useActionState(updateChurchInfo, undefined)

  return (
    <section>
      <h3 className="text-base font-semibold text-foreground mb-1">Church Information</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Displayed on donation receipts sent to members.
      </p>
      {/* key remounts the uncontrolled inputs when revalidated props change */}
      <form
        action={formAction}
        className="space-y-3"
        key={JSON.stringify([churchName, churchAddress, churchABN, churchEmail, churchWebsite])}
      >
        <div>
          <Label htmlFor="church-name">Church name</Label>
          <Input
            id="church-name"
            name="churchName"
            type="text"
            required
            defaultValue={churchName}
            placeholder={DEFAULT_CHURCH_NAME}
            className="mt-1"
            maxLength={200}
          />
        </div>
        <div>
          <Label htmlFor="church-address">Address</Label>
          <Input
            id="church-address"
            name="churchAddress"
            type="text"
            defaultValue={churchAddress}
            placeholder="123 Example St, Sydney NSW 2000"
            className="mt-1"
            maxLength={500}
          />
        </div>
        <div>
          <Label htmlFor="church-abn">ABN</Label>
          <Input
            id="church-abn"
            name="churchABN"
            type="text"
            defaultValue={churchABN}
            placeholder="12 345 678 901"
            className="mt-1"
            maxLength={20}
          />
        </div>
        <div>
          <Label htmlFor="church-email">Email</Label>
          <Input
            id="church-email"
            name="churchEmail"
            type="email"
            defaultValue={churchEmail}
            placeholder="office@example.com"
            className="mt-1"
            maxLength={255}
          />
        </div>
        <div>
          <Label htmlFor="church-website">Website</Label>
          <Input
            id="church-website"
            name="churchWebsite"
            type="url"
            defaultValue={churchWebsite}
            placeholder="https://www.example.com"
            className="mt-1"
            maxLength={500}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Shown as a link on the public membership and family-update forms. Leave blank to hide it.
          </p>
        </div>
        <FormFeedback state={state} />
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save church information"}</Button>
      </form>
    </section>
  )
}
