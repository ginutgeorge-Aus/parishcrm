import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the birthdays & anniversaries feature is off. */
export default async function DashboardPeopleAnniversariesFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("celebrations")
  return children
}
