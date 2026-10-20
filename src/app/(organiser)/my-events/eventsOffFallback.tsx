import { redirect } from "next/navigation"
import { getEnabledFeatures } from "@/lib/featureFlags"

/**
 * What /my-events shows while Events is off. This is the organiser's home
 * (middleware sends EVENT_ORGANISER here), so it must not 404: send them to
 * their Sunday School classes, or show a short notice. Shared by the layout
 * and the page, since a client navigation back to /my-events from a child
 * route keeps the layout mounted and only re-renders the page.
 * @returns null while Events is on; otherwise the notice (or redirects)
 */
export async function eventsOffFallback(): Promise<React.ReactElement | null> {
  const features = await getEnabledFeatures()
  if (features.has("events")) return null
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
