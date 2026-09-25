import { encrypt } from "@/lib/crypto"

// Single source of truth for which Family fields are encrypted on write (
// ). Mutates `data` in place, encrypting only truthy fields so an empty
// string is never written as plaintext PII (AUDIT-021). Lives outside the
// "use server" action modules (family.ts / familyUpdate.ts) so both can reuse it
// — exporting this sync helper from a "use server" file would be a build error.
export function encryptFamilyFields(data: {
  address?: string | null
  suburb?: string | null
  state?: string | null
  postcode?: string | null
  homePhone?: string | null
  notes?: string | null
}) {
  if (data.address) data.address = encrypt(data.address)
  if (data.suburb) data.suburb = encrypt(data.suburb)
  if (data.state) data.state = encrypt(data.state)
  if (data.postcode) data.postcode = encrypt(data.postcode)
  if (data.homePhone) data.homePhone = encrypt(data.homePhone)
  if (data.notes) data.notes = encrypt(data.notes)
}
