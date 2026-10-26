"use client"

import { upsertSetting } from "@/lib/actions/settings"
import { EMAIL_FOOTER_KEY, EMAIL_FOOTER_MAX } from "@/lib/emailTemplates"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { useKeepFormValues } from "./useKeepFormValues"
import { useFormDirty } from "./unsavedChanges"
import { SettingsCard } from "./ui/SettingsCard"
import { SettingsRow, joinDescribedBy } from "./ui/SettingsRow"

/**
 * Email footer card: the text appended to the bottom of every outgoing email.
 * Saves through the generic `upsertSetting` action (ADMIN only); blank turns it off.
 * @param props.footer the stored footer template, or the default when none is stored
 */
export function EmailFooterForm({ footer }: Readonly<{ footer: string }>) {
  const [state, formAction, isPending, keep] = useKeepFormValues(upsertSetting)
  const { ref } = useFormDirty(state)
  const errorId = "emailFooter-error"
  return (
    <SettingsCard title="Email footer" description="Added to the bottom of every email the app sends.">
      <form ref={ref} action={formAction}>
        <input type="hidden" name="key" value={EMAIL_FOOTER_KEY} />
        <SettingsRow
          label="Footer text"
          htmlFor="emailFooter"
          description={
            <>
              Use <code>{"{churchName}"}</code> to insert your church name. Plain text only, up to {EMAIL_FOOTER_MAX} characters.
              Leave blank to turn the footer off.
            </>
          }
        >
          {(descId) => (
            <>
              <Textarea
                id="emailFooter"
                name="value"
                rows={3}
                maxLength={EMAIL_FOOTER_MAX}
                defaultValue={keep("value", footer)}
                aria-describedby={joinDescribedBy(descId, state && "error" in state && state.error && errorId)}
              />
              <div className="mt-2 flex justify-end">
                <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save"}</Button>
              </div>
              <FormFeedback id={errorId} state={state} />
            </>
          )}
        </SettingsRow>
      </form>
    </SettingsCard>
  )
}
