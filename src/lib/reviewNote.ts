import { safeDecrypt } from "@/lib/crypto"

/**
 * Read helper for `FamilyUpdateSubmission.reviewNote` and `MembershipApplication.reviewNote`.
 * Both columns are AES-GCM encrypted by their writers (`rejectFamilyUpdate`, `rejectMembership`),
 * so any screen that displays a note must go through this instead of rendering the raw column.
 * @param stored the raw `reviewNote` column value (ciphertext, or null when no note was left)
 * @returns the plaintext note, null when there is none, or safeDecrypt's "[decryption error]"
 *   placeholder when the stored value cannot be decrypted (callers should not treat that as a real note)
 */
export function readReviewNote(stored: string | null | undefined): string | null {
  if (!stored) return null
  return safeDecrypt(stored)
}
