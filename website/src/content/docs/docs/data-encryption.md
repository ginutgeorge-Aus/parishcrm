---
title: "Data Encryption"
description: "Sensitive personal and financial fields are encrypted at rest with AES-256-GCM, independent of database-level disk encryption. This page covers which fields…"
---

Sensitive personal and financial fields are encrypted at rest with AES-256-GCM, independent
of database-level disk encryption. This page covers which fields are encrypted, how the key
scheme and rotation work, and how equality lookups (like "find this person by email")
function against encrypted columns. See [Privacy-and-Audit-Log](/parishcrm/docs/privacy-and-audit-log/) for retention/purge and
[Security-Model](/parishcrm/docs/security-model/) for the request-layer protections around this data.

## Using it

Encryption is transparent to staff using the app — encrypted fields display and search
normally through the UI (e.g. searching people by email works). There's nothing to turn on
or off day-to-day. The operationally relevant actions are all one-off admin/ops tasks:

- **Rotating the encryption key** (recommended periodically, and required if a key is ever
  suspected compromised) is a scripted, dry-run-by-default operation — see **Configuration**
  below and `docs/operations.md`.
- **Verifying nothing is stored in plaintext that shouldn't be** — a read-only diagnostic
  script scans every encrypted-at-rest field and blind-index hash for completeness, intended
  to be run against a production (or restored) database periodically.

## How it works

**Algorithm and format.** `src/lib/crypto.ts` (backed by `src/lib/cryptoCore.ts`) exposes
`encrypt(plaintext)` / `decrypt(value)` using AES-256-GCM with a fresh random 12-byte IV per
encryption. The stored format is `enc:<keyId>:<iv>:<authTag>:<ciphertext>` (base64 segments),
so a value's key generation travels with it. `decrypt()` is safe to call on data that was
never encrypted — a value not prefixed `enc:` is returned unchanged — and it validates that
the iv/tag/ciphertext segments are well-formed base64 before treating a value as ciphertext,
so a free-text note a staff member typed that happens to start with `enc:` isn't mistaken for
corrupted ciphertext.

**Encrypted fields.** Field-level encryption is applied wherever personal or sensitive
financial content is stored, including but not limited to: family and person contact details
(address, phone numbers, email, date of birth), pastoral and emergency-contact notes,
transaction descriptions and notes, receipt/reminder recipient addresses, event-registration
contact details and custom-answer text (dietary, medical, accessibility, emergency-contact
free text — encrypted as a single JSON blob), petty-cash payee/notes, membership-application
payload/signature/contact details, DGR (tax-deductible) receipt donor email, transaction
attachment filenames and file contents, and child-safety clearance (WWCC / Safe Ministry)
numbers, document files, filenames and verification notes. A dedicated CI-run test greps every encryption write
site in the codebase against a maintained list, so a newly-added sensitive field that's
written without encryption fails the build rather than shipping silently.

**Equality search on encrypted fields — blind indexes.** Because encryption uses a random IV,
the same plaintext produces different ciphertext every time, so a normal `WHERE email = ...`
database query cannot match an encrypted column. For the two fields the app needs to look up
by exact value — person/registration email and person/membership-application mobile number —
a separate, deterministic **blind index** column stores a keyed HMAC of the normalized
plaintext (lower-cased/trimmed for email; AU-prefix-normalized for mobile), computed from the
plaintext *before* encryption and kept alongside the ciphertext on every write path. Lookups
query the hash column instead of decrypting every row. A blind index deliberately reveals
whether two records share the same value (linkability) without revealing the value itself —
an accepted tradeoff here, since matching a person to their own event registrations is the
whole point.

**Key rotation.** Keys are named `ENCRYPTION_KEY_V1`, `ENCRYPTION_KEY_V2`, and so on (a bare
`ENCRYPTION_KEY` is treated as an alias for `v1`), with `ENCRYPTION_KEY_ID` naming which one
is current. New encryptions always use the current key; decryption reads the key id embedded
in the stored value and looks it up in the full keyring, so old and new ciphertext coexist
during a rotation. A dedicated script re-encrypts every field under the new current key. It
is dry-run by default, idempotent (safe to re-run), processes every encrypted table even if
one row is malformed (a bad row is skipped and counted, not fatal to the run), and reports a
non-zero exit if anything was skipped so a partial rotation is a visible finding, not a
silent gap. The email/mobile blind-index HMAC key is deliberately derived from the *original*
v1 key rather than the current one, specifically so rotating forward never orphans existing
lookup hashes — the v1 key must never be deleted while any v1-encrypted data or hash could
still exist.

**Boot-time health check.** On container startup, a keyring health check runs and, in
production, refuses to start if the encryption key looks obviously wrong (all-zero bytes, a
repeated byte, or otherwise too low in entropy) — a fail-fast guard against deploying with a
placeholder or corrupted key, rather than silently encrypting real data under a weak key.

## Configuration

| Variable | Purpose |
|---|---|
| `ENCRYPTION_KEY` | The field-encryption key, treated as key `v1` when no explicit `ENCRYPTION_KEY_V1` is set. Losing this key makes all encrypted data permanently unrecoverable — back it up separately from the database. |
| `ENCRYPTION_KEY_V1`, `ENCRYPTION_KEY_V2`, … | Explicit, generationed keys for rotation. `v1` must be kept indefinitely even after rotating forward — it derives the email/mobile blind-index hashes and decrypts any not-yet-rotated value. |
| `ENCRYPTION_KEY_ID` | Names which generation is "current" for new encryptions. Boot refuses to start if this is set to anything other than `v1` while `v1` is only available via the implicit `ENCRYPTION_KEY` alias — promote it to an explicit `ENCRYPTION_KEY_V1` first. |

Rotation procedure, in order: set `ENCRYPTION_KEY_V1` to the current key's value, add the new
key as `ENCRYPTION_KEY_V2`, set `ENCRYPTION_KEY_ID=v2`, deploy, then run the rotation script
with its apply flag. Full step-by-step is in `docs/operations.md` and the header comments of
`scripts/rotate-encryption-key.ts`.
