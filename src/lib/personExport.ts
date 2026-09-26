import { hmacEmail, safeDecrypt } from "@/lib/crypto"

// gemini-nightly: person.emailHash is set on every write since
// (src/lib/actions/person.ts), but a record created/imported before that
// change — or any row the one-time backfill (scripts/backfill-email-hash.ts)
// hasn't reached yet — can still have `email` set with `emailHash` null. The
// person data-portability export joined Registration solely on emailHash, so
// those legacy records silently exported zero registrations even though a
// matching decrypted email exists. Derive the same blind index on the fly as
// a fallback so the lookup still hits.
export function resolveEmailHash(emailHash: string | null, decryptedEmail: string | null): string | null {
  return emailHash ?? (decryptedEmail ? hmacEmail(decryptedEmail) : null)
}

// Decrypt-on-read for a Person row's at-rest-encrypted scalars, for the
// data-portability export. safeDecrypt throughout: one corrupt field becomes
// a placeholder rather than 500-ing the whole export. `email` is handled by
// the caller (it feeds resolveEmailHash before this runs).
export function decryptPersonScalars<T extends {
  dateOfBirth: string | null
  mobile: string | null
  workPhone: string | null
  homePhone: string | null
  notes: string | null
  pastoralNotes: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
}>(person: T): T {
  return {
    ...person,
    dateOfBirth: person.dateOfBirth ? safeDecrypt(person.dateOfBirth) : null,
    mobile: person.mobile ? safeDecrypt(person.mobile) : null,
    workPhone: person.workPhone ? safeDecrypt(person.workPhone) : null,
    homePhone: person.homePhone ? safeDecrypt(person.homePhone) : null,
    notes: person.notes ? safeDecrypt(person.notes) : null,
    pastoralNotes: person.pastoralNotes ? safeDecrypt(person.pastoralNotes) : null,
    emergencyContactName: person.emergencyContactName ? safeDecrypt(person.emergencyContactName) : null,
    emergencyContactPhone: person.emergencyContactPhone ? safeDecrypt(person.emergencyContactPhone) : null,
  }
}

// Decrypt-on-read for a Family row's at-rest-encrypted scalars, for the
// data-portability export.
export function decryptFamilyScalars<T extends {
  address: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  homePhone: string | null
  notes: string | null
}>(family: T): T {
  return {
    ...family,
    address: family.address ? safeDecrypt(family.address) : null,
    suburb: family.suburb ? safeDecrypt(family.suburb) : null,
    state: family.state ? safeDecrypt(family.state) : null,
    postcode: family.postcode ? safeDecrypt(family.postcode) : null,
    homePhone: family.homePhone ? safeDecrypt(family.homePhone) : null,
    notes: family.notes ? safeDecrypt(family.notes) : null,
  }
}

// Decrypt-on-read for a Transaction row's at-rest-encrypted scalars, for the
// data-portability export. amount is stringified — Decimal doesn't survive
// JSON.stringify as a number.
export function decryptTransactionForExport<T extends {
  amount: { toString(): string }
  description: string
  receiptSends: Array<{ sentTo: string }>
}>(tx: T): Omit<T, "amount"> & { amount: string } {
  return {
    ...tx,
    amount: tx.amount.toString(),
    description: safeDecrypt(tx.description),
    receiptSends: tx.receiptSends.map((rs) => ({ ...rs, sentTo: safeDecrypt(rs.sentTo) })),
  }
}

// customAnswers is encrypted-whole as a JSON string scalar. Decrypt + parse so
// a data-portability export returns the member's real answers, not opaque
// ciphertext. Legacy plaintext-object rows pass through unchanged.
function decryptCustomAnswers(customAnswers: unknown): unknown {
  if (!customAnswers) return null
  if (typeof customAnswers !== "string") return customAnswers
  try {
    return JSON.parse(safeDecrypt(customAnswers))
  } catch {
    return null
  }
}

// Decrypt-on-read for a Registration row's at-rest-encrypted scalars, for the
// data-portability export.
export function decryptRegistrationForExport<T extends {
  email: string | null
  phone: string | null
  customAnswers: unknown
}>(registration: T): T {
  return {
    ...registration,
    email: registration.email ? safeDecrypt(registration.email) : null,
    phone: registration.phone ? safeDecrypt(registration.phone) : null,
    customAnswers: decryptCustomAnswers(registration.customAnswers),
  }
}
