import { Button } from "@/components/ui/button"

// CSV export resolves by slug when the event has one, else by id (slugless
// staff-only events); the print page route is keyed by integer id.
type Props = { eventId: number; slug: string | null }

export function ExportButtons({ eventId, slug }: Readonly<Props>) {
  return (
    <div className="flex gap-2">
      <Button asChild variant="outline" size="sm">
        <a href={slug ? `/api/events/${encodeURIComponent(slug)}/export-csv` : `/api/event-exports/${eventId}/csv`}>Export CSV</a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={`/events/${eventId}/registrations/print`} target="_blank" rel="noopener noreferrer">Export PDF</a>
      </Button>
    </div>
  )
}
