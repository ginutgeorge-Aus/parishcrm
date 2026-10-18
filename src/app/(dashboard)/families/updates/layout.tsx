import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the family self-updates feature is off. */
export default async function DashboardFamiliesUpdatesFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("familyUpdates")
  return children
}
