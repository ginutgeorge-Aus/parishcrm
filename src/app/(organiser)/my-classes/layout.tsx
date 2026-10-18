import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the Sunday School feature is off. */
export default async function OrganiserMyClassesFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("sundaySchool")
  return children
}
