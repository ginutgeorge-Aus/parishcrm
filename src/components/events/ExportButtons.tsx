import { Button } from "@/components/ui/button"

// CSV export resolves the event by slug (the [slug] API segment); the print
// page route is keyed by integer id. A staff-only event has no slug, so the CSV
// link is hidden for it while the PDF link always renders.
type Props = { eventId: number; slug: string | null }

/** Registration export links: CSV (slug-keyed, only when slug exists) and print/PDF (id-keyed). */
export function ExportButtons({ eventId, slug }: Readonly<Props>) {
  return (
    <div className="flex gap-2">
      {slug && (
        <Button asChild variant="outline" size="sm">
          <a href={`/api/events/${encodeURIComponent(slug)}/export-csv`}>Export CSV</a>
        </Button>
      )}
      <Button asChild variant="outline" size="sm">
        <a href={`/events/${eventId}/registrations/print`} target="_blank" rel="noopener noreferrer">Export PDF</a>
      </Button>
    </div>
  )
}
