import { redirect } from "next/navigation"
import { getEnabledFeatures } from "@/lib/featureFlags"

/**
 * Gates /my-events on the events feature. This is the organiser's home
 * (middleware sends EVENT_ORGANISER here), so while Events is off it must not
 * 404: send them to their Sunday School classes, or show a short notice.
 */
export default async function OrganiserMyEventsFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const features = await getEnabledFeatures()
  if (features.has("events")) return children
  if (features.has("sundaySchool")) redirect("/my-classes")
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-border bg-card p-6 text-center">
      <h1 className="text-lg font-semibold text-foreground">Nothing to manage right now</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Events aren&apos;t in use at the moment. Ask your church office if you expected to see something here.
      </p>
    </div>
  )
}
