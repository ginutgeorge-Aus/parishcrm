import { prisma } from "@/lib/prisma"
import { requireSettingsTab } from "@/lib/settingsAccess"
import { senderAddress } from "@/lib/mailConfig"
import { AppSettingsForm } from "@/components/settings/AppSettingsForm"
import { ChurchInfoForm } from "@/components/settings/ChurchInfoForm"

/** Settings → General: church identity and app-wide settings. */
export default async function GeneralSettingsPage() {
  const { features } = await requireSettingsTab("/settings")
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

  return (
    <>
      <ChurchInfoForm
        churchName={get("churchName") || (process.env.CHURCH_NAME ?? "")}
        churchAddress={get("churchAddress") || (process.env.CHURCH_ADDRESS ?? "")}
        churchABN={get("churchABN") || (process.env.CHURCH_ABN ?? "")}
        churchEmail={get("churchEmail") || senderAddress()}
        churchWebsite={churchWebsite}
      />
      <AppSettingsForm
        ownerNotificationEmail={get("ownerNotificationEmail")}
        membershipSecretaryEmail={get("membershipSecretaryEmail")}
        idleTimeoutMinutes={Number.parseInt(get("SESSION_IDLE_TIMEOUT_MINUTES") || "60", 10) || 60}
        cardFeePercent={get("cardFeePercent") || "1.7"}
        cardFeeFixed={get("cardFeeFixed") || "0.30"}
        showMembership={features.has("memberships")}
        showCardFee={features.has("events")}
      />
    </>
  )
}
