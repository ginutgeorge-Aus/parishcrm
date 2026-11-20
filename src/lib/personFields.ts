import { encrypt, hmacEmail, hmacMobile } from "@/lib/crypto"

/** Encrypted Person fields the edit form pre-fills via safeDecrypt. */
export const PERSON_ENCRYPTED_KEYS = [
  "email", "dateOfBirth", "mobile", "workPhone", "homePhone",
  "notes", "pastoralNotes", "emergencyContactName", "emergencyContactPhone",
] as const

/** Every encrypted-at-rest Person text field a write path may carry. */
const PERSON_WRITE_ENCRYPTED_KEYS = [
  ...PERSON_ENCRYPTED_KEYS, "profession", "maritalStatus",
] as const

/**
 * Single source of truth for which Person fields are encrypted on write.
 * Mutates `data` in place, encrypting only truthy fields so an empty string is
 * never written as plaintext PII. Keys that are absent are skipped, so callers
 * that drop role-gated fields (pastoral notes, emergency contact) or omit
 * unreadable values (AUD-1-03) keep their stored ciphertext.
 *
 * Also keeps the `emailHash`/`mobileHash` blind indexes in step: when the data
 * carries an `email`/`mobile` key, the hash is set from the plaintext (computed
 * BEFORE encrypting) or to null when the value is blank. Absent key leaves the
 * stored hash untouched. Lives outside the "use server" action modules so
 * person.ts, familyUpdate.ts, membership.ts and the CSV import can share it.
 *
 * @param data - Person create/update data; mutated in place
 */
export function encryptPersonFields(data: {
  email?: string | null
  emailHash?: string | null
  mobile?: string | null
  mobileHash?: string | null
  [key: string]: unknown
}) {
  if (data.email !== undefined) data.emailHash = data.email ? hmacEmail(data.email) : null
  if (data.mobile !== undefined) data.mobileHash = data.mobile ? hmacMobile(data.mobile) : null
  for (const k of PERSON_WRITE_ENCRYPTED_KEYS) {
    const v = data[k]
    if (typeof v === "string" && v) data[k] = encrypt(v)
  }
}
