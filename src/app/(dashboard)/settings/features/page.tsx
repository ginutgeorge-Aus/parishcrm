import { requireSettingsTab } from "@/lib/settingsAccess"
import { readRawOverrides } from "@/lib/featureFlags"
import { FeaturesForm } from "@/components/settings/FeaturesForm"

export const dynamic = "force-dynamic"

type Props = Readonly<{ searchParams: Promise<{ welcome?: string }> }>

/** Settings → Features: ADMIN picks which features this church uses. */
export default async function FeaturesPage({ searchParams }: Props) {
  const [{ welcome }, { data: initial }] = await Promise.all([
    searchParams,
    requireSettingsTab("/settings/features", readRawOverrides),
  ])
  return <FeaturesForm initial={initial} welcome={welcome === "1"} />
}
