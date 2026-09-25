// Shared event-form option lists — used by both the EventForm UI and the
// event server action's Zod schema so the allowed values stay in one place.

export const CATEGORIES = ["worship", "youth", "fellowship", "education", "parish", "special"] as const

export const RECURS_OPTIONS = [
  { value: "every-sunday", label: "Every Sunday" },
  { value: "2nd-sunday", label: "2nd Sunday of month" },
  { value: "3rd-sunday", label: "3rd Sunday of month" },
  { value: "4th-sunday", label: "4th Sunday of month" },
] as const

// Just the recurrence values, in declaration order — the Zod enum source.
export const RECURS = ["every-sunday", "2nd-sunday", "3rd-sunday", "4th-sunday"] as const
