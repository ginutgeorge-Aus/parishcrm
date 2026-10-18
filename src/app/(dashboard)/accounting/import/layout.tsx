import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the bank import feature is off. */
export default async function DashboardAccountingImportFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("bankImport")
  return children
}
