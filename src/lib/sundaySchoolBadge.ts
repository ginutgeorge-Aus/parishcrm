import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"
import { deriveDomainKey } from "@/lib/crypto"

// Sunday School student badge QR (OSS-11). Payload `ss1.<personId>.<sig>`:
// sig = first 16 bytes (128 bit) of HMAC-SHA256("ss-badge:<personId>") under a
// key HKDF-derived from the encryption keyring with its own domain label, so
// no new env var and no reuse of the blind-index keys. The QR carries no PII:
// only the numeric id and a signature, so a forged or guessed id never scans.

const PREFIX = "ss1"
const SIG_BYTES = 16
const KEY_LABEL = "ss-badge"
// 16 bytes -> 22 base64url chars, no padding.
const PAYLOAD_RE = /^ss1\.([1-9]\d{0,9})\.([A-Za-z0-9_-]{22})$/

/**
 * Truncated HMAC for a person id.
 * @param personId positive integer person id
 */
function sign(personId: number): Buffer {
  return createHmac("sha256", deriveDomainKey(KEY_LABEL)).update(`ss-badge:${personId}`).digest().subarray(0, SIG_BYTES)
}

/**
 * Build the signed QR payload for a student's badge.
 * @param personId positive integer person id
 */
export function signBadge(personId: number): string {
  if (!Number.isSafeInteger(personId) || personId < 1) throw new Error("signBadge: invalid person id")
  return `${PREFIX}.${personId}.${sign(personId).toString("base64url")}`
}

/**
 * Verify scanned QR text. Strict format parse, constant-time signature compare.
 * @param text raw decoded QR text
 * @returns the person id, or null for anything malformed, forged or foreign
 */
export function verifyBadge(text: string): number | null {
  if (typeof text !== "string") return null
  const m = PAYLOAD_RE.exec(text.trim())
  if (!m) return null
  const personId = Number(m[1])
  if (personId > 2_147_483_647) return null
  const given = Buffer.from(m[2], "base64url")
  const want = sign(personId)
  if (given.length !== want.length) return null
  return timingSafeEqual(given, want) ? personId : null
}
