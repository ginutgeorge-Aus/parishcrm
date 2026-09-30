// Which outbound mail transport is active. RESEND_API_KEY switches from Gmail
// SMTP to the Resend HTTPS API (for hosts that block SMTP, e.g. Railway Hobby).
export function isResendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

// The address mail is sent from — also the fallback church contact email.
export function senderAddress(): string {
  return (isResendConfigured() ? process.env.MAIL_FROM : process.env.GMAIL_USER) ?? ""
}
