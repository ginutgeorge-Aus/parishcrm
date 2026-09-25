import "server-only"
import { createHmac } from "crypto"
import { sendEmail } from "@/lib/email"
import { getChurchSettings } from "@/lib/churchSettings"
import { PRIMARY_HEX } from "@/lib/theme/palette"

// 6-digit code in [100000, 999999]. Rejection sampling removes the modulo bias
// of a bare `% 900000`: 2^32 is not a multiple of 900000, so the top partial
// bucket would over-represent ~167k low values (AUDIT-009). Discard draws
// in that partial bucket and re-roll — uniform over the full 900000 range.
const OTP_RANGE = 900000
const OTP_LIMIT = 0x1_0000_0000 - (0x1_0000_0000 % OTP_RANGE) // largest 2^32 multiple of range

export function generateOtp(): string {
  const array = new Uint32Array(1)
  let v: number
  do {
    crypto.getRandomValues(array)
    v = array[0]
  } while (v >= OTP_LIMIT)
  return String(100000 + (v % OTP_RANGE))
}

// HMAC keyed with AUTH_SECRET — a DB-only compromise can't brute-force the
// 6-digit space offline without also having the server secret.
export function hashOtp(code: string): string {
  // NEXTAUTH_SECRET fallback: a half-renamed prod env must never take
  // logins down again (2026-06-06 incident). Matches website-sync.ts pattern.
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET is required to hash OTP codes")
  return createHmac("sha256", secret).update(code).digest("hex")
}

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const { name: churchName } = await getChurchSettings()
  await sendEmail(
    to,
    // OTP must NOT go in the subject: mail servers, MDAs, clients and
    // scanning middleware store/log subjects in plaintext. Code lives in the body only.
    `Your ${churchName} login verification code`,
    `<p>Your login verification code is:</p>
     <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:${PRIMARY_HEX}">${code}</p>
     <p style="color:#64748b">Expires in 10 minutes. Do not share it.</p>`,
    `Your ${churchName} login code: ${code}\n\nExpires in 10 minutes.`,
  )
}
