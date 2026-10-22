import { requireSettingsTab } from "@/lib/settingsAccess"
import { getLetterSettings } from "@/lib/letterSettings"
import { getMembershipSettings } from "@/lib/membershipSettings"
import { LetterSettingsForm } from "@/components/settings/LetterSettingsForm"
import { MembershipSettingsForm } from "@/components/settings/MembershipSettingsForm"

/** Settings → Members: welcome letter and membership form settings, per enabled feature. */
export default async function MembersSettingsPage() {
  const { features } = await requireSettingsTab("/settings/members")
  const [letter, membership] = await Promise.all([
    features.has("welcomeLetter") ? getLetterSettings() : null,
    features.has("memberships") ? getMembershipSettings() : null,
  ])
  return (
    <>
      {letter && <LetterSettingsForm settings={letter} />}
      {membership && <MembershipSettingsForm settings={membership} />}
    </>
  )
}
