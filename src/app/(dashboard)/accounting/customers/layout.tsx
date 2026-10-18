import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the invoices feature is off. */
export default async function DashboardAccountingCustomersFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("invoices")
  return children
}
