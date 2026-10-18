import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the petty cash feature is off. */
export default async function PrintPettyCashFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("pettyCash")
  return children
}
