import { requireFeature } from "@/lib/featureFlags"

/** Blocks the volunteer crew view (404) while the events feature is off. */
export default async function PublicCrewFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("events")
  return children
}
