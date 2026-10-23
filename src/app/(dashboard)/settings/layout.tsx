import { redirect } from "next/navigation"
import { isAdmin } from "@/lib/roleGuard"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { getSettingsSession } from "@/lib/settingsAccess"
import { DemoNotice } from "@/components/DemoNotice"
import { buildSettingsTabs } from "@/components/settings/settingsTabs"
import { SettingsTabs } from "@/components/settings/SettingsTabs"
import { UnsavedChangesProvider } from "@/components/settings/unsavedChanges"

/**
 * Settings area shell: heading, feature-filtered tab list (left on md+,
 * Select below) and the active tab's page. ADMIN only.
 * @param props.children the active settings tab page
 */
export default async function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSettingsSession()
  if (!isAdmin(session?.user?.role)) redirect("/")
  const groups = buildSettingsTabs(await getEnabledFeatures())
  return (
    <UnsavedChangesProvider>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <DemoNotice />
        <div className="flex flex-col gap-4 md:flex-row md:gap-8">
          <SettingsTabs groups={groups} />
          <div className="min-w-0 max-w-3xl flex-1 space-y-6">{children}</div>
        </div>
      </div>
    </UnsavedChangesProvider>
  )
}
