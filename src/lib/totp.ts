import "server-only"
import { randomInt } from "node:crypto"
import { Secret, TOTP } from "otpauth"

// Authenticator-app defaults (Google/Microsoft Authenticator only support
// SHA-1 / 6 digits / 30 s reliably).
const PERIOD = 30
const WINDOW = 1
const BACKUP_CODE_COUNT = 10
// Crockford base32 — no I/L/O/U, so codes survive being read aloud or handwritten.
const BACKUP_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export const TOTP_CODE_RE = /^\d{6}$/
export const BACKUP_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/

function totpFor(secret: string, issuer = "", label = ""): TOTP {
  return new TOTP({ issuer, label, algorithm: "SHA1", digits: 6, period: PERIOD, secret: Secret.fromBase32(secret) })
}

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

export function totpKeyUri(secret: string, email: string, issuer: string): string {
  return totpFor(secret, issuer, email).toString()
}

// Returns the absolute 30-s step the code matched (within ±1), or null. Callers
// persist the step and reject any later code whose step is not strictly newer —
// that is the replay guard, so the step (not just a boolean) is the contract.
export function matchTotpStep(secret: string, code: string, now: number = Date.now()): number | null {
  if (!TOTP_CODE_RE.test(code)) return null
  const delta = totpFor(secret).validate({ token: code, timestamp: now, window: WINDOW })
  if (delta === null) return null
  return Math.floor(now / 1000 / PERIOD) + delta
}

export function generateBackupCodes(): string[] {
  const codes = new Set<string>()
  while (codes.size < BACKUP_CODE_COUNT) {
    let raw = ""
    for (let i = 0; i < 10; i++) raw += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)]
    codes.add(`${raw.slice(0, 5)}-${raw.slice(5)}`)
  }
  return [...codes]
}

export function normaliseBackupCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "")
}
