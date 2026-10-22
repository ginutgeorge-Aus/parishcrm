import { requireSettingsTab } from "@/lib/settingsAccess"
import { BrandingForm } from "@/components/settings/BrandingForm"

/** Settings → Branding: logo, letterhead and other brand images. */
export default async function BrandingSettingsPage() {
  await requireSettingsTab("/settings/branding")
  return <BrandingForm />
}
