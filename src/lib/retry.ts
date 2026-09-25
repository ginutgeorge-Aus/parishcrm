/**
 * Bounded retry with exponential backoff.
 *
 * Generic and side-effect-free: the caller decides how many attempts, which
 * errors are worth retrying, and (in tests) how to sleep. Used to make transient
 * transactional-email failures self-heal instead of blocking a password reset or
 * new-user onboarding on a single Gmail-SMTP hiccup.
 */
export type RetryOptions = {
  /** Total attempts including the first (default 3 → 1 try + 2 retries). */
  attempts?: number
  /** Backoff base in ms; delay before retry N is base * 2^(N-1) (default 300). */
  baseDelayMs?: number
  /** Return true if the error is worth retrying. Default: retry everything. */
  isRetryable?: (err: unknown) => boolean
  /** Called before each backoff sleep (observability hook). */
  onRetry?: (err: unknown, attempt: number) => void
  /** Injectable sleep — override in tests to avoid real timers. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3)
  const base = opts.baseDelayMs ?? 300
  const isRetryable = opts.isRetryable ?? (() => true)
  const sleep = opts.sleep ?? defaultSleep

  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      // Last attempt, or a non-transient error → give up immediately.
      if (attempt >= attempts || !isRetryable(err)) throw err
      opts.onRetry?.(err, attempt)
      await sleep(base * 2 ** (attempt - 1))
    }
  }
  // Unreachable (the loop either returns or throws), but satisfies the type.
  throw lastErr
}
