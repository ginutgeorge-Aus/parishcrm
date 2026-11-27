import { formatSydneyDate, formatSydneyTime } from "@/lib/dates"

/**
 * One-line "date, start to end · location" caption for a roster service.
 */
export function ServiceWhen({ startsAt, endsAt, location }: Readonly<{ startsAt: Date; endsAt: Date; location: string | null }>) {
  return (
    <p className="text-sm text-muted-foreground">
      {formatSydneyDate(startsAt)}, {formatSydneyTime(startsAt)} to {formatSydneyTime(endsAt)}
      {location ? ` · ${location}` : ""}
    </p>
  )
}
