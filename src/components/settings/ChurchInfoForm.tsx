"use client"

import { updateChurchInfo } from "@/lib/actions/settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { useKeepFormValues } from "./useKeepFormValues"
import { useFormDirty } from "./unsavedChanges"
import { SettingsCard } from "./ui/SettingsCard"
import { SettingsRow } from "./ui/SettingsRow"
import { DEFAULT_CHURCH_NAME } from "@/lib/settingsConstants"

type Props = {
  churchName: string
  churchAddress: string
  churchABN: string
  churchEmail: string
  churchWebsite: string
}

/**
 * Church identity card (name, address, ABN, email, website), saved together.
 * @param props the current saved values
 */
export function ChurchInfoForm({ churchName, churchAddress, churchABN, churchEmail, churchWebsite }: Readonly<Props>) {
  const [state, formAction, isPending, keep] = useKeepFormValues(updateChurchInfo)
  const { ref } = useFormDirty()

  return (
    // key remounts the uncontrolled inputs (and the dirty baseline) when revalidated props change
    <form
      ref={ref}
      action={formAction}
      key={JSON.stringify([churchName, churchAddress, churchABN, churchEmail, churchWebsite])}
    >
      <SettingsCard
        title="Church information"
        description="Displayed on donation receipts sent to members."
        footer={<Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save church information"}</Button>}
      >
        <SettingsRow label="Church name" htmlFor="church-name">
          <Input
            id="church-name"
            name="churchName"
            type="text"
            required
            defaultValue={keep("churchName", churchName)}
            placeholder={DEFAULT_CHURCH_NAME}
            className="md:w-80"
            maxLength={200}
          />
        </SettingsRow>
        <SettingsRow label="Address" htmlFor="church-address">
          <Input
            id="church-address"
            name="churchAddress"
            type="text"
            defaultValue={keep("churchAddress", churchAddress)}
            placeholder="123 Example St, Sydney NSW 2000"
            className="md:w-80"
            maxLength={500}
          />
        </SettingsRow>
        <SettingsRow label="ABN" htmlFor="church-abn">
          <Input
            id="church-abn"
            name="churchABN"
            type="text"
            defaultValue={keep("churchABN", churchABN)}
            placeholder="12 345 678 901"
            className="md:w-80"
            maxLength={20}
          />
        </SettingsRow>
        <SettingsRow label="Email" htmlFor="church-email">
          <Input
            id="church-email"
            name="churchEmail"
            type="email"
            defaultValue={keep("churchEmail", churchEmail)}
            placeholder="office@example.com"
            className="md:w-80"
            maxLength={255}
          />
        </SettingsRow>
        <SettingsRow
          label="Website"
          htmlFor="church-website"
          description="Shown as a link on the public membership and family-update forms. Leave blank to hide it."
        >
          <Input
            id="church-website"
            name="churchWebsite"
            type="url"
            defaultValue={keep("churchWebsite", churchWebsite)}
            placeholder="https://www.example.com"
            className="md:w-80"
            maxLength={500}
          />
        </SettingsRow>
        <FormFeedback state={state} />
      </SettingsCard>
    </form>
  )
}
