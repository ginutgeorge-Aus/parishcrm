import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the clearances feature is off. */
export default async function DashboardPeopleClearancesFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("clearances")
  return children
}
