import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the giving receipts feature is off. */
export default async function DashboardAccountingSendReceiptsFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("receipts")
  return children
}
