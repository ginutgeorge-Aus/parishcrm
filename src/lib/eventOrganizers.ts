// Event organiser contacts (public-facing "who to contact" for an event).
// Stored as Event.organizers Json? — an array of { name, phone? }.
//
// Pure module (mirrors eventQuestions.ts): every export of a "use server" file
// must be async, so this sync FormData parser lives outside the actions file.

export const MAX_ORGANIZERS = 10
const MAX_NAME = 200
const MAX_PHONE = 50

export type Organizer = {
  name: string
  /** Optional — a name-only organiser is valid; the field is omitted, not "". */
  phone?: string
}

// Reads the contiguous `organizer.${i}.name` / `.phone` rows the form submits.
// Blank-name rows are dropped (a removed/empty row must not persist). Caps the
// count at MAX_ORGANIZERS and each field's length.
export function parseOrganizers(formData: FormData): Organizer[] {
  const organizers: Organizer[] = []
  let i = 0
  while (formData.has(`organizer.${i}.name`)) {
    // Hard stop on the *iteration* count, not just organizers.length — a blank
    // name is skipped without growing the array, so thousands of contiguous
    // blank organizer.N.name rows before one filled row would otherwise force
    // unbounded FormData reads before the output cap could ever trip.
    if (i >= MAX_ORGANIZERS) break
    const name = ((formData.get(`organizer.${i}.name`) as string) || "").trim().slice(0, MAX_NAME)
    const phone = ((formData.get(`organizer.${i}.phone`) as string | null) || "").trim().slice(0, MAX_PHONE)
    if (name) {
      const org: Organizer = { name }
      if (phone) org.phone = phone
      organizers.push(org)
    }
    i++
  }
  return organizers
}
