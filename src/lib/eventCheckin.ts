// A registration publicToken is "REG-" + hex (see eventRegistration.ts). A
// scanned QR holds the raw token, but be defensive if it ever carries a
// full URL: pull the first REG-… match out and normalise to upper case. Returns
// null when the decoded text has no token — the scanner then keeps looking.
const REG_TOKEN = /REG-[0-9A-Fa-f]+/i

export function extractRegToken(decoded: string): string | null {
  const m = decoded.trim().match(REG_TOKEN)
  return m ? m[0].toUpperCase() : null
}
