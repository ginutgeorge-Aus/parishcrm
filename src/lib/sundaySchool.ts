import { z } from "zod"
import { sydneyParts } from "@/lib/dates"

/** Highest class level (0 = Kindy/Prep … 12 = Year 12, headroom for youth groups). */
export const MAX_LEVEL = 20

/**
 * Class create/edit form. `level` arrives as a string from FormData and must be
 * a whole number 0..MAX_LEVEL (a digit regex, not `z.coerce`, so a blank field
 * is rejected instead of coercing to 0). `location` is optional and normalised
 * to "" (not null) because the DB unique (year, name, location) needs a NOT
 * NULL column.
 */
export const ClassFormSchema = z.object({
  name: z.string().trim().min(1, "Class name is required").max(80, "Class name is too long"),
  level: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, "Level must be a whole number")
    .transform(Number)
    .pipe(z.number().max(MAX_LEVEL, `Level must be 0–${MAX_LEVEL}`)),
  location: z.string().trim().max(80, "Location is too long").default(""),
})

/** The school year "now" — the Sydney calendar year (AU school year = calendar year). */
export function currentSchoolYear(at: Date = new Date()): number {
  return sydneyParts(at).year
}

export type RolloverClassInput = {
  id: number
  name: string
  level: number
  location: string
  teacherPersonIds: number[]
  childPersonIds: number[]
}

export type RolloverPlan = {
  classes: { sourceId: number; name: string; level: number; location: string; teacherPersonIds: number[] }[]
  /** `targetSourceId` = the SOURCE class whose new copy receives the child. */
  placements: { personId: number; targetSourceId: number }[]
  /** personIds left unenrolled (top level, or ambiguous target). */
  unplaced: number[]
}

/**
 * Plan a year rollover without touching the DB. Every class is copied (same
 * name/level/location/teachers). Each child moves to the ONE class at
 * level+1 in the same location; if there is none (top level) or more than one
 * (ambiguous), the child is returned in `unplaced` for staff to place by hand.
 */
export function planRollover(classes: RolloverClassInput[]): RolloverPlan {
  const key = (level: number, location: string) => `${level}\u0000${location}`
  const byKey = new Map<string, number[]>()
  for (const c of classes) {
    const k = key(c.level, c.location)
    byKey.set(k, [...(byKey.get(k) ?? []), c.id])
  }
  const placements: RolloverPlan["placements"] = []
  const unplaced: number[] = []
  for (const c of classes) {
    const targets = byKey.get(key(c.level + 1, c.location)) ?? []
    for (const personId of c.childPersonIds) {
      if (targets.length === 1) placements.push({ personId, targetSourceId: targets[0] })
      else unplaced.push(personId)
    }
  }
  return {
    classes: classes.map((c) => ({
      sourceId: c.id,
      name: c.name,
      level: c.level,
      location: c.location,
      teacherPersonIds: c.teacherPersonIds,
    })),
    placements,
    unplaced,
  }
}
