import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the reconciliation feature is off. */
export default async function DashboardAccountingReportsReconciliationFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("reconciliation")
  return children
}
