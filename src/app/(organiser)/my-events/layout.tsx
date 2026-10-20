import { eventsOffFallback } from "./eventsOffFallback"

/** Gates /my-events on the events feature, falling back instead of a 404. */
export default async function OrganiserMyEventsFeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (await eventsOffFallback()) ?? children
}
