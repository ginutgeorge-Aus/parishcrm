import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { AppSettingsForm } from "@/components/settings/AppSettingsForm"
import { BirthdayEmailForm } from "@/components/settings/BirthdayEmailForm"
import { AnniversaryEmailForm } from "@/components/settings/AnniversaryEmailForm"
import { AutoEmailToggles } from "@/components/settings/AutoEmailToggles"
import { ChurchInfoForm } from "@/components/settings/ChurchInfoForm"
import { BrandingForm } from "@/components/settings/BrandingForm"
import { LetterSettingsForm } from "@/components/settings/LetterSettingsForm"
import { MembershipSettingsForm } from "@/components/settings/MembershipSettingsForm"
import { ActivityFeed } from "@/components/settings/ActivityFeed"
import { getBirthdayTemplate, getAnniversaryTemplate, getAutoEmailFlags } from "@/lib/actions/settings"
import { EmailTemplatesSection } from "@/components/settings/EmailTemplatesSection"
import { getEmailTemplate } from "@/lib/emailTemplateStore"
import { EMAIL_TEMPLATE_KEYS, type EmailTemplateKey, type EmailTemplateFields } from "@/lib/emailTemplates"
import { getLetterSettings } from "@/lib/letterSettings"
import { getMembershipSettings } from "@/lib/membershipSettings"
import { getReceiptSettings } from "@/lib/receiptSettings"
import { ReceiptSettingsSection } from "@/components/settings/ReceiptSettingsSection"

const GIT_SHA_DISPLAY_LENGTH = 7

export default async function SettingsPage() {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/")

  const settings = await prisma.appSetting.findMany({
    where: { key: { in: ["ownerNotificationEmail", "membershipSecretaryEmail", "churchName", "churchAddress", "churchABN", "churchEmail", "churchWebsite", "SESSION_IDLE_TIMEOUT_MINUTES", "cardFeePercent", "cardFeeFixed"] } },
  })
  const get = (key: string) => settings.find((s) => s.key === key)?.value ?? ""
  // churchWebsite: a saved row (even blank) must win over the env fallback, so an
  // admin who cleared the field to hide the public links doesn't get the env URL
  // re-populated into the form and written back on the next save. Mirrors
  // getChurchSettings()'s website handling.
  const websiteRow = settings.find((s) => s.key === "churchWebsite")
  const churchWebsite = websiteRow ? websiteRow.value : (process.env.CHURCH_WEBSITE ?? "")

  const birthdayTpl = await getBirthdayTemplate()
  const anniversaryTpl = await getAnniversaryTemplate()
  const autoEmailFlags = await getAutoEmailFlags()
  const letterSettings = await getLetterSettings()
  const membershipSettings = await getMembershipSettings()
  const receiptSettings = await getReceiptSettings()

  const tplEntries = await Promise.all(
    EMAIL_TEMPLATE_KEYS.map(async (k) => [k, await getEmailTemplate(k)] as const),
  )
  const emailTemplates = Object.fromEntries(tplEntries) as Record<EmailTemplateKey, EmailTemplateFields>

  const [auditEntries, recentRegistrations] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, action: true, resourceType: true, resourceId: true, createdAt: true, user: { select: { name: true } } },
    }),
    prisma.registration.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, firstName: true, lastName: true, createdAt: true, event: { select: { title: true } } },
    }),
  ])

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-6">App Settings</h2>
      <div className="space-y-10 max-w-lg">
        <ChurchInfoForm
          churchName={get("churchName") || (process.env.CHURCH_NAME ?? "")}
          churchAddress={get("churchAddress") || (process.env.CHURCH_ADDRESS ?? "")}
          churchABN={get("churchABN") || (process.env.CHURCH_ABN ?? "")}
          churchEmail={get("churchEmail") || (process.env.GMAIL_USER ?? "")}
          churchWebsite={churchWebsite}
        />
        <hr className="border-border" />
        <BrandingForm />
        <hr className="border-border" />
        <LetterSettingsForm settings={letterSettings} />
        <hr className="border-border" />
        <MembershipSettingsForm settings={membershipSettings} />
        <hr className="border-border" />
        <BirthdayEmailForm subject={birthdayTpl.subject} body={birthdayTpl.body} />
        <hr className="border-border" />
        <AnniversaryEmailForm subject={anniversaryTpl.subject} body={anniversaryTpl.body} />
        <hr className="border-border" />
        <AutoEmailToggles birthday={autoEmailFlags.birthday} anniversary={autoEmailFlags.anniversary} />
        <hr className="border-border" />
        <AppSettingsForm
          ownerNotificationEmail={get("ownerNotificationEmail")}
          membershipSecretaryEmail={get("membershipSecretaryEmail")}
          idleTimeoutMinutes={parseInt(get("SESSION_IDLE_TIMEOUT_MINUTES") || "60", 10) || 60}
          cardFeePercent={get("cardFeePercent") || "1.7"}
          cardFeeFixed={get("cardFeeFixed") || "0.30"}
        />
      </div>
      <div className="mt-10">
        <EmailTemplatesSection templates={emailTemplates} />
      </div>
      <div className="mt-10">
        <ReceiptSettingsSection settings={receiptSettings} />
      </div>
      <div className="mt-10 max-w-lg">
        <ActivityFeed
          isAdmin
          auditEntries={auditEntries}
          registrations={recentRegistrations}
        />
      </div>
      <div className="mt-8">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">About</h3>
        <p className="text-sm text-muted-foreground">
          Version {process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}
          {process.env.NEXT_PUBLIC_GIT_SHA ? ` · ${process.env.NEXT_PUBLIC_GIT_SHA.slice(0, GIT_SHA_DISPLAY_LENGTH)}` : ""}
        </p>
      </div>
    </div>
  )
}
