import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the events feature is off. */
export default async function OrganiserMyEventsFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("events")
  return children
}
