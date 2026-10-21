import { requireSettingsTab } from "@/lib/settingsAccess"
import { SettingsCard } from "@/components/settings/ui/SettingsCard"
import { SettingsRow } from "@/components/settings/ui/SettingsRow"

const GIT_SHA_DISPLAY_LENGTH = 7

/** Settings → About: the release and build this instance runs. */
export default async function AboutSettingsPage() {
  await requireSettingsTab("/settings/about")
  const sha = process.env.NEXT_PUBLIC_GIT_SHA
  return (
    <SettingsCard title="About" description="The ParishCRM release this site runs.">
      <SettingsRow label="Version">
        <span className="text-sm">{process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}</span>
      </SettingsRow>
      {sha && (
        <SettingsRow label="Build">
          <code className="text-sm">{sha.slice(0, GIT_SHA_DISPLAY_LENGTH)}</code>
        </SettingsRow>
      )}
    </SettingsCard>
  )
}
