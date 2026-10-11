import { encrypt, safeDecrypt } from "@/lib/crypto"

/** Encrypt an optional form value: empty string → null, otherwise ciphertext. */
export function encryptOrNull(v: string): string | null {
  return v ? encrypt(v) : null
}

/** Decrypt an optional column: null/empty → null, otherwise plaintext. */
export function decryptOrNull(v: string | null): string | null {
  return v ? safeDecrypt(v) : null
}
