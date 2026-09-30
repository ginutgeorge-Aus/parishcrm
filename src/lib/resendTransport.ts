import { randomUUID } from "node:crypto"

// Resend HTTPS API transport. Exists because some hosts (Railway Free/Trial/
// Hobby) block outbound SMTP entirely, so Gmail SMTP times out and OTP login
// is impossible there; port 443 is never blocked. Plain fetch, no SDK — it's
// one endpoint.
const RESEND_URL = "https://api.resend.com/emails"
const ATTEMPTS = 3
const BASE_DELAY_MS = 500
const TIMEOUT_MS = 30_000

type Attachment = { filename: string; content: Buffer | string; contentType: string }

export type ResendMailOptions = {
  from: string
  to: string
  subject: string
  html?: string
  text: string
  attachments?: Attachment[]
}

type ResendOptions = { sleep?: (ms: number) => Promise<void> }

// Carries only the HTTP status + Resend's error `name` — never its `message`,
// which can echo the recipient address into logs.
class ResendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly ambiguous = false,
  ) {
    super(message)
    this.name = "ResendError"
  }
}

// A network error or timeout can strike after Resend accepted the message, so
// once retries are exhausted delivery is unknown — the owner alert must say so.
export function isResendAmbiguous(err: unknown): boolean {
  return err instanceof ResendError && err.ambiguous
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function toBody(opts: ResendMailOptions) {
  return {
    from: opts.from,
    // Settings store multi-recipient values as "a@x.com, b@y.com".
    to: opts.to.split(",").map((s) => s.trim()).filter(Boolean),
    subject: opts.subject,
    ...(opts.html === undefined ? {} : { html: opts.html }),
    text: opts.text,
    ...(opts.attachments?.length
      ? {
          attachments: opts.attachments.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.content).toString("base64"),
            content_type: a.contentType,
          })),
        }
      : {}),
  }
}

async function errorName(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { name?: unknown }
    return typeof data.name === "string" ? data.name : "unknown_error"
  } catch {
    return "unknown_error"
  }
}

async function attempt(apiKey: string, body: string, key: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new ResendError("Resend request failed (network error or timeout)", undefined, true)
  }
  if (res.ok) return
  throw new ResendError(`Resend API error ${res.status} (${await errorName(res)})`, res.status)
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof ResendError)) return false
  return err.ambiguous || err.status === 429 || (err.status ?? 0) >= 500
}

export function createResendTransport(apiKey: string, { sleep = defaultSleep }: ResendOptions = {}) {
  return {
    async sendMail(opts: ResendMailOptions): Promise<void> {
      // One key per message, reused across retries: Resend dedupes on it, so
      // retrying a timeout or 5xx can never deliver a duplicate.
      const key = randomUUID()
      const body = JSON.stringify(toBody(opts))
      for (let i = 1; ; i++) {
        try {
          return await attempt(apiKey, body, key)
        } catch (err) {
          if (i >= ATTEMPTS || !isRetryable(err)) throw err
          await sleep(BASE_DELAY_MS * 2 ** (i - 1))
        }
      }
    },
  }
}
