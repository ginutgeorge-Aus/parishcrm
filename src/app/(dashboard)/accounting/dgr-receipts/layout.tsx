import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the DGR receipts feature is off. */
export default async function DashboardAccountingDgrReceiptsFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("dgrReceipts")
  return children
}
