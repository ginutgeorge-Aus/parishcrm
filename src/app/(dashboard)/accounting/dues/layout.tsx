import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the subscription dues feature is off. */
export default async function DashboardAccountingDuesFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("dues")
  return children
}
