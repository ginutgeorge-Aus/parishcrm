import { headers } from "next/headers"
import { recordRouteView } from "@/lib/routeViews"

// Aggregate-only route-view counter ( Phase 3) lives in the TEMPLATE, not
// the layout: App Router layouts do NOT re-render on client-side navigation, so
// a counter in the layout would only record the entry route per session.
// Templates re-render on every navigation, so this fires once per page view.
// No user/session recorded; middleware sets x-pathname (pathname only, no query).
// Fire-and-forget — recordRouteView never throws.
export default async function DashboardTemplate({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-pathname")
  if (path) recordRouteView(path)
  return <>{children}</>
}
