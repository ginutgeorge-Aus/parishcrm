import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the accounting feature is off. */
export default async function DashboardFamiliesIdGivingFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("accounting")
  return children
}
