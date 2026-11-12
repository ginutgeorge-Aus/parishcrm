import type { FeatureKey } from "@/lib/features"

/**
 * Where the organiser shell's home/brand link points. `isEventsHome` says
 * whether that is the /my-events page itself, so callers never re-compare paths.
 */
export type OrganiserHome = { href: string; label: string; isEventsHome: boolean }

/** The classes page as home: a TEACHER's only surface, or organisers with Events off. */
export const CLASSES_HOME: OrganiserHome = { href: "/my-classes", label: "My Classes", isEventsHome: false }

/**
 * The organiser's home for the current feature set: Events is the home, unless
 * it is off and Sunday School is on, when it is the classes page. The single
 * routing decision shared by the header and `eventsOffFallback`.
 * @param features enabled feature set
 */
export function organiserHome(features: ReadonlySet<FeatureKey>): OrganiserHome {
  return !features.has("events") && features.has("sundaySchool")
    ? CLASSES_HOME
    : { href: "/my-events", label: "My Events", isEventsHome: true }
}
