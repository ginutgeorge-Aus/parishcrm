import { formatSydneyDate, formatSydneyTime } from "@/lib/dates"
import { fmtAUD } from "@/lib/formatting"
import type { Organizer } from "@/lib/eventOrganizers"
import { Calendar, MapPin, User, Ticket } from "lucide-react"

type TicketType = {
  id: number
  name: string
  /** Dollars. Canonicalised to a number by the page server component. */
  price: number
}

type Props = {
  title: string
  description: string | null
  date: Date | null
  endDate: Date | null
  location: string | null
  organizers?: Organizer[]
  ticketTypes: TicketType[]
  recursLabel?: string | null
  startTime?: string | null
  category?: string | null
  posterSrc?: string | null
  bannerSrc?: string | null
}

// Human-readable badge label per Event.category. Falls back to "Event".
const CATEGORY_LABELS: Record<string, string> = {
  worship: "Worship Service",
  youth: "Youth Event",
  fellowship: "Fellowship",
  education: "Education",
  parish: "Parish Event",
  special: "Special Event",
}

export function EventHero({ title, description, date, endDate, location, organizers, ticketTypes, recursLabel, startTime, category, posterSrc, bannerSrc }: Props) {
  const categoryLabel = (category && CATEGORY_LABELS[category]) || "Event"
  return (
    <div className="flex-1 p-6">
      {/* Poster hero (large) when a poster exists; otherwise the banner strip. */}
      {posterSrc ? (
        <div className="relative rounded-xl overflow-hidden mb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={posterSrc} alt={title} className="w-full max-h-[70vh] object-contain bg-muted" />
          <div className="absolute bottom-0 left-0 right-0 p-5 bg-linear-to-t from-black/70 to-transparent">

            <span className="text-xs text-white/80 bg-white/20 rounded px-2 py-1 mb-2 inline-block">
              {categoryLabel}
            </span>
            <h1 className="text-white font-bold text-2xl">{title}</h1>
          </div>
        </div>
      ) : (
        <div className="relative rounded-xl overflow-hidden h-40 flex items-end p-5 mb-5 bg-linear-to-br from-primary to-gold">
          {bannerSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bannerSrc} alt={title} className="absolute inset-0 w-full h-full object-cover" />
          )}
          <div className="relative">
            <span className="text-xs text-white/80 bg-white/20 rounded px-2 py-1 mb-2 inline-block">
              {categoryLabel}
            </span>
            <h1 className="text-white font-bold text-2xl">{title}</h1>
          </div>
        </div>
      )}

      {/* Meta */}
      <div className="flex flex-col gap-2 mb-5 text-foreground">
        <div className="flex items-center gap-2 text-sm">
          <Calendar aria-hidden="true" className="h-4 w-4" />
          <span>
            {date ? (
              <>
                <strong>{formatSydneyDate(date)}</strong>
                {" · "}
                {formatSydneyTime(date)}
                {endDate && ` – ${formatSydneyTime(endDate)}`}
              </>
            ) : (
              <>
                <strong>{recursLabel || "Recurring"}</strong>
                {startTime && ` · ${startTime}`}
              </>
            )}
          </span>
        </div>
        {location && (
          <div className="flex items-center gap-2 text-sm">
            <MapPin aria-hidden="true" className="h-4 w-4" />
            <span>{location}</span>
          </div>
        )}
        {organizers && organizers.length > 0 && (
          <div className="flex items-start gap-2 text-sm">
            <User aria-hidden="true" className="h-4 w-4" />
            <span>
              <span className="text-muted-foreground">
                {organizers.length === 1 ? "Organiser: " : "Organisers: "}
              </span>
              {organizers.map((o, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  {o.name}
                  {o.phone && (
                    <>
                      {" "}
                      <a href={`tel:${o.phone.replace(/\s+/g, "")}`} className="text-primary underline">
                        {o.phone}
                      </a>
                    </>
                  )}
                </span>
              ))}
            </span>
          </div>
        )}
        {ticketTypes.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <Ticket aria-hidden="true" className="h-4 w-4" />
            <span>
              {ticketTypes
                .map(tt => `${tt.name} ${fmtAUD(tt.price)}`)
                .join(" · ")}
            </span>
          </div>
        )}
      </div>

      {/* Description */}
      {description && (
        <div className="mb-5">
          <h2 className="font-semibold text-foreground mb-2">About this event</h2>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{description}</p>
        </div>
      )}

      {/* Ticket price list */}
      {ticketTypes.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground mb-3">Ticket Prices</p>
          <div className="flex flex-col gap-2">
            {ticketTypes.map(tt => (
              <div key={tt.id} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{tt.name}</span>
                <span className="font-semibold text-foreground">
                  {tt.price === 0 ? "Free" : fmtAUD(tt.price)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
