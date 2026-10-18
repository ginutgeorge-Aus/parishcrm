import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the budget feature is off. */
export default async function DashboardAccountingBudgetFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("budget")
  return children
}
