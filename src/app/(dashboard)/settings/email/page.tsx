import { requireSettingsTab } from "@/lib/settingsAccess"
import { getAnniversaryTemplate, getAutoEmailFlags, getBirthdayTemplate } from "@/lib/actions/settings"
import { isVenueUsageEnabled } from "@/lib/venueUsageSettings"
import { getEmailTemplate } from "@/lib/emailTemplateStore"
import { EMAIL_TEMPLATE_KEYS, visibleEmailTemplateKeys, type EmailTemplateFields, type EmailTemplateKey } from "@/lib/emailTemplates"
import { BirthdayEmailForm } from "@/components/settings/BirthdayEmailForm"
import { AnniversaryEmailForm } from "@/components/settings/AnniversaryEmailForm"
import { AutoEmailToggles } from "@/components/settings/AutoEmailToggles"
import { EmailTemplatesSection } from "@/components/settings/EmailTemplatesSection"
import { SettingsCard } from "@/components/settings/ui/SettingsCard"

/** Settings → Email: blessing emails (when Celebrations is on) and system email templates. */
export default async function EmailSettingsPage() {
  const { features } = await requireSettingsTab("/settings/email")
  const celebrations = features.has("celebrations")
  const [birthday, anniversary, autoFlags, tplEntries, venueUsage] = await Promise.all([
    celebrations ? getBirthdayTemplate() : null,
    celebrations ? getAnniversaryTemplate() : null,
    celebrations ? getAutoEmailFlags() : null,
    Promise.all(EMAIL_TEMPLATE_KEYS.map(async (k) => [k, await getEmailTemplate(k)] as const)),
    isVenueUsageEnabled(),
  ])
  const templates = Object.fromEntries(tplEntries) as Record<EmailTemplateKey, EmailTemplateFields>
  return (
    <>
      {birthday && anniversary && autoFlags && (
        <SettingsCard title="Blessing emails" description="Birthday and anniversary emails sent to members.">
          <AutoEmailToggles birthday={autoFlags.birthday} anniversary={autoFlags.anniversary} />
          <BirthdayEmailForm subject={birthday.subject} body={birthday.body} />
          <AnniversaryEmailForm subject={anniversary.subject} body={anniversary.body} />
        </SettingsCard>
      )}
      <EmailTemplatesSection templates={templates} keys={visibleEmailTemplateKeys(features, { venueUsage })} />
    </>
  )
}
