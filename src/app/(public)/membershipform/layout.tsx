import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the membership forms feature is off. */
export default async function PublicMembershipformFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("memberships")
  return children
}
