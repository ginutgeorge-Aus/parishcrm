import { hmacEmail } from "@/lib/crypto"

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
