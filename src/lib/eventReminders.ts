const DAY_MS = 24 * 60 * 60 * 1000

type ReminderEvent = {
  kind: string
  date: Date | null
  reminderDaysBefore: number | null
  reminderSentAt: Date | null
  isPublished: boolean
}

/**
 * True when a one-off event is inside its reminder lead window and has not been
 * reminded yet. Pure (no DB); `now` is injected so it is unit testable.
 */
export function isReminderDue(event: ReminderEvent, now: Date): boolean {
  if (!event.isPublished) return false
  if (event.kind !== "one_off") return false
  if (!event.date) return false
  if (event.reminderDaysBefore == null) return false
  if (event.reminderSentAt) return false
  const eventTime = event.date.getTime()
  if (eventTime < now.getTime()) return false // already passed
  const windowStart = eventTime - event.reminderDaysBefore * DAY_MS
  return now.getTime() >= windowStart
}
