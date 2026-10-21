import type { FeatureKey } from "@/lib/features"

/** Where the organiser shell's home/brand link points. */
export type OrganiserHome = { href: string; label: string }

/**
 * The organiser's home for the current feature set: Events is the home, unless
 * it is off and Sunday School is on, when it is the classes page. The single
 * routing decision shared by the header and `eventsOffFallback`.
 * @param features enabled feature set
 */
export function organiserHome(features: ReadonlySet<FeatureKey>): OrganiserHome {
  return !features.has("events") && features.has("sundaySchool")
    ? { href: "/my-classes", label: "My Classes" }
    : { href: "/my-events", label: "My Events" }
}
