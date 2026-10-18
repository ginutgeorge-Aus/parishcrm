import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment (404) while the welcome letter feature is off. */
export default async function DashboardWelcomeLetterFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("welcomeLetter")
  return children
}
