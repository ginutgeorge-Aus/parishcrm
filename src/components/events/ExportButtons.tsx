import { Button } from "@/components/ui/button"

// CSV export resolves the event by slug (the [slug] API segment); the print
// page route is keyed by integer id. Pass both so each link uses the right key.
type Props = { eventId: number; slug: string }

export function ExportButtons({ eventId, slug }: Props) {
  return (
    <div className="flex gap-2">
      <Button asChild variant="outline" size="sm">
        <a href={`/api/events/${encodeURIComponent(slug)}/export-csv`}>Export CSV</a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={`/events/${eventId}/registrations/print`} target="_blank">Export PDF</a>
      </Button>
    </div>
  )
}
