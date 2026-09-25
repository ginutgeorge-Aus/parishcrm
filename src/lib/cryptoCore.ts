// Encryption keyring implementation. App/server code must import this via
// `@/lib/crypto`, which adds the build-time `server-only` guard. Node ops scripts
// (seed, encrypt-* backfills, key rotation) import this module directly because
// `server-only` throws under plain Node/tsx. The runtime browser guard below is
// the defense-in-depth backstop for that direct-import path.
if (typeof window !== "undefined") {
  throw new Error("src/lib/crypto-core.ts must never be imported into client/browser code")
}
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_BYTES = 12

// distinguish "our ciphertext" from free text that merely starts with
// `enc:`. Previously keyIdOf()/decrypt() treated ANY string starting with
// `enc:` that split into 4-5 colon segments as ciphertext — no positive marker
// separated it from plaintext. A free-text field (notes, pastoral notes,
// petty-cash payee) a user types starting with `enc:` plus the right colon
// count routed straight into decrypt(), which fails the GCM auth-tag check
// (fails safe — never returns wrong plaintext) but surfaces as a
// "[decryption error]" placeholder for a value that was never encrypted: a
// false-positive corruption signal.
//
// Two positive markers, in priority order:
//   1. The versioned key-id prefix `enc:v<n>:` (5-segment form). This alone
//      proves the value is ours — a human will never type `enc:v1:`. It
//      qualifies EVEN IF the payload segments are later found corrupt, so a
//      bit-flipped ciphertext ( bad-row class) still reaches decrypt()
//      and is surfaced/counted, instead of being silently downgraded to
//      plaintext and hidden from the rotation audit (reviewer).
//   2. Valid base64 across all payload segments. Needed for the legacy
//      unversioned 4-segment form (which has no key-id marker) and for a
//      5-segment value whose key-id segment isn't `v<n>` but whose payload is
//      well-formed (e.g. `enc:v1x:<b64>:<b64>:<b64>` — malformed key id that
//      decrypt() must still reach and reject with "invalid key id",/).
//
// A value that has neither marker (right colon count but a non-`v<n>` key-id
// segment AND a non-base64 payload) is free text → returned/keyed as plaintext.
// Residual false-positive (all-base64 non-versioned segments that are actually
// prose) is the low-likelihood case the original already accepted.
const BASE64_SEGMENT_RE = /^[A-Za-z0-9+/]*={0,2}$/
const KEY_ID_RE = /^v\d+$/

function hasEncryptedShape(value: string): boolean {
  if (!value.startsWith("enc:")) return false
  const parts = value.split(":")
  if (parts.length === 5) {
    // Versioned marker qualifies regardless of payload validity (marker 1);
    // otherwise fall back to the base64 payload signal (marker 2).
    if (KEY_ID_RE.test(parts[1])) return true
    return parts.slice(2).every((s) => BASE64_SEGMENT_RE.test(s))
  }
  if (parts.length === 4) {
    // Legacy unversioned form: no key-id marker, so valid base64 across the
    // three payload segments is the only positive signal.
    return parts.slice(1).every((s) => BASE64_SEGMENT_RE.test(s))
  }
  return false
}

type Keyring = { keys: Map<string, Buffer>; currentId: string }

// Resolved from env on every call (like the previous per-call getKey()) so
// tests and rotations can change the keyring without module reloads.
function loadKeyring(): Keyring {
  const keys = new Map<string, Buffer>()
  for (const [name, val] of Object.entries(process.env)) {
    const m = name.match(/^ENCRYPTION_KEY_(V\d+)$/)
    if (m && val) keys.set(m[1].toLowerCase(), Buffer.from(val, "base64"))
  }
  // Back-compat: the single ENCRYPTION_KEY becomes v1 unless V1 is set explicitly.
  const v1FromAlias = !keys.has("v1") && !!process.env.ENCRYPTION_KEY
  if (v1FromAlias) {
    keys.set("v1", Buffer.from(process.env.ENCRYPTION_KEY!, "base64"))
  }
  if (keys.size === 0) throw new Error("ENCRYPTION_KEY env var is not set")
  for (const [id, key] of keys) {
    if (key.byteLength !== 32) {
      throw new Error(
        `Encryption key "${id}" must decode to 32 bytes (got ${key.byteLength}) — generate with: openssl rand -base64 32`
      )
    }
  }
  const currentId = (process.env.ENCRYPTION_KEY_ID ?? "v1").toLowerCase()
  if (!keys.has(currentId)) {
    throw new Error(`No encryption key for current key id "${currentId}"`)
  }
  // once rotated past v1, the v1 key must be supplied explicitly via
  // ENCRYPTION_KEY_V1 — not the implicit ENCRYPTION_KEY alias. Otherwise an
  // operator who deletes the "old" ENCRYPTION_KEY after rotating forward
  // silently orphans any un-rotated v1 ciphertext (the alias is its only
  // source). Failing the boot here forces the documented "promote to an
  // explicit ENCRYPTION_KEY_V1 first" step before retirement is possible.
  if (currentId !== "v1" && v1FromAlias) {
    throw new Error(
      `ENCRYPTION_KEY_ID is "${currentId}" but the v1 key is supplied only via the implicit ` +
        `ENCRYPTION_KEY alias. Promote it to an explicit ENCRYPTION_KEY_V1=<same key> so ` +
        `ENCRYPTION_KEY can be retired without orphaning un-rotated v1 data. See scripts/rotate-encryption-key.ts.`
    )
  }
  return { keys, currentId }
}

export function currentKeyId(): string {
  return loadKeyring().currentId
}

// Key id a stored value was encrypted under: explicit id for 5-segment values,
// "v1" for legacy 4-segment values, null for non-encrypted plaintext (
// including anything that merely LOOKS like ciphertext by colon count but
// whose payload segments aren't valid base64 — see hasEncryptedShape above).
export function keyIdOf(value: string): string | null {
  if (!hasEncryptedShape(value)) return null
  const parts = value.split(":")
  if (parts.length === 5) return parts[1]
  return "v1"
}

export function encrypt(plaintext: string): string {
  const { keys, currentId } = loadKeyring()
  const key = keys.get(currentId)!
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `enc:${currentId}:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`
}

export function decrypt(value: string): string {
  // not our ciphertext format (no `enc:` prefix, wrong colon count, or
  // a payload segment that isn't valid base64) — treat as plaintext rather
  // than attempting decryption. See hasEncryptedShape's comment above.
  if (!hasEncryptedShape(value)) return value
  const { keys } = loadKeyring()
  const parts = value.split(":")
  let keyId: string
  let ivB64: string
  let authTagB64: string
  let ciphertextB64: string
  if (parts.length === 5) {
    ;[, keyId, ivB64, authTagB64, ciphertextB64] = parts
  } else {
    keyId = "v1"
    ;[, ivB64, authTagB64, ciphertextB64] = parts
  }
  // /: keyId is parsed from attacker-storable ciphertext. Validate its
  // format before the keyring lookup and never echo it in the error — the
  // message propagates to onRequestError logging and would leak the key-
  // versioning scheme. (Legacy 4-segment values set keyId="v1", which matches.)
  if (!/^v\d+$/.test(keyId)) throw new Error("Decryption failed: invalid key id")
  const key = keys.get(keyId)
  if (!key) throw new Error("Decryption failed: unknown key id")
  // authTagLength pins the expected tag size — without it GCM accepts
  // truncated tags, enabling forgery via shortened-tag brute force.
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"), { authTagLength: 16 })
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]).toString("utf8")
}

// Bulk-export placeholder for a value that cannot be decrypted (legacy/corrupt
// ciphertext, wrong/rotated key). Mirrors the receipt/birthday send paths so a
// single bad row degrades to a visible marker instead of 500-ing the whole
// export. Use only on read paths that iterate many rows.
const DECRYPTION_ERROR_PLACEHOLDER = "[decryption error]"

export function safeDecrypt(value: string): string {
  try {
    return decrypt(value)
  } catch {
    return DECRYPTION_ERROR_PLACEHOLDER
  }
}

// deterministic blind index over email addresses. Person.email and
// Registration.email are encrypted with a random IV, so they can't be matched
// with a WHERE clause — the person-export previously decrypt-scanned the whole
// registrations table. hmacEmail() gives every email a stable keyed digest
// stored alongside the ciphertext, so equality lookups (registration <-> person)
// become an indexed `WHERE emailHash = ...` with no scan and no creation-order
// dependency.
//
// The HMAC key is HKDF-derived from the v1 encryption key, NOT the current key:
// the blind index must survive key rotation (re-keying it would orphan every
// stored hash), and v1 is the permanent root (encryption.md forbids deleting it
// while any v1 data remains). HKDF with a fixed info label keeps the index key
// domain-separated from the encryption key. CAVEAT: if v1 is ever genuinely
// retired (full rotation + 0 v1 rows), the emailHash columns must be rebuilt
// from a new root.
function blindIndexKey(label: string): Buffer {
  const { keys } = loadKeyring()
  const v1 = keys.get("v1")
  if (!v1) throw new Error(`${label} blind index requires the v1 encryption key`)
  return Buffer.from(hkdfSync("sha256", v1, Buffer.alloc(0), `${label}-blind-index-v1`, 32))
}

export function hmacEmail(email: string): string {
  return createHmac("sha256", blindIndexKey("email")).update(email.trim().toLowerCase()).digest("hex")
}

// canonicalise an AU mobile number before hashing so "0412345678",
// "+61412345678", "61412345678", and spaced/dashed variants of the same number
// all normalise to one form and hash identically. Without this, hmacMobile
// only trimmed whitespace, so format-different-but-same-number inputs silently
// failed the Person<->MembershipApplication blind-index match ('s whole
// reason for existing). Strips everything but digits (keeping a leading `+`
// just long enough to detect the country code), then folds a `+61`/`61`
// prefix down to the local `0` form.
function normaliseMobile(mobile: string): string {
  const digitsAndLeadingPlus = mobile.trim().replace(/(?!^\+)[^\d]/g, "")
  return digitsAndLeadingPlus.replace(/^\+?61/, "0")
}

// same blind-index pattern as hmacEmail, over mobile numbers — lets
// MembershipApplication.mobile (now encrypted) match Person.mobile (already
// encrypted with a random IV) via an indexed WHERE instead of plaintext
// equality. Domain-separated label keeps it independent of the email index.
export function hmacMobile(mobile: string): string {
  return createHmac("sha256", blindIndexKey("mobile")).update(normaliseMobile(mobile)).digest("hex")
}

function isWeakKey(key: Buffer): boolean {
  // A real 256-bit random key has ~30 distinct byte values; all-zero, single
  // repeated-byte, or short-pattern keys have very few. Threshold kept low to
  // avoid false positives on legitimately random keys.
  return new Set(key).size < 8
}

// Boot-time keyring health check — call ONCE at startup (from
// instrumentation.ts register()), never per encrypt/decrypt. loadKeyring()
// runs on every crypto call, so entropy gating / warnings must not live there.
export function assertKeyringHealthy(): void {
  const { keys, currentId } = loadKeyring()
  // reject low-entropy keys — production only, so dev/test fixtures
  // (fixed-byte keys) and the Jest suite are unaffected. loadKeyring() already
  // enforces the 32-byte length; this adds the entropy floor.
  if (process.env.NODE_ENV === "production") {
    for (const [id, key] of keys) {
      if (isWeakKey(key)) {
        throw new Error(`Encryption key "${id}" has insufficient entropy — generate with: openssl rand -base64 32`)
      }
    }
  }
  // warn once about non-current keys lingering in the keyring (retirement
  // candidates). No hard window — operational reminder only.
  const retirable = [...keys.keys()].filter((id) => id !== currentId)
  if (retirable.length > 0) {
    console.warn(
      `[crypto] keyring holds non-current key id(s) ${retirable.join(", ")} (current: ${currentId}). ` +
        `Once the rotation script reports 0 rows on an old id, retire that key. See scripts/rotate-encryption-key.ts.`,
    )
  }
}
