import "server-only"

// Simple in-memory fixed-window rate limiter, keyed by an arbitrary string
// (e.g. `search:<userId>`). Returns true if the request is allowed, false if
// the key has already hit `limit` within the current `windowMs`.
//
// SAFE ONLY AT A SINGLE REPLICA — the Container App is pinned to
// --max-replicas 1 (deploy.yml). If that cap is ever raised, move this
// to a shared store (Postgres/Redis) first, or an attacker can spread requests
// across replicas to bypass it. collectEnvWarnings() (env-check.ts) logs a boot
// warning if CONTAINER_APP_REPLICA_COUNT > 1 so a scale-out doesn't go unnoticed.
//
// Fixed window, no boundary carry-over (accepted): a client can send
// `limit` requests at the tail of one window and `limit` more at the head of the
// next (~2x burst in a sub-second span). Accepted at church scale — the guarded
// paths (event register/waitlist) also have per-account/CAPTCHA backstops; a
// sliding-window/token-bucket rewrite isn't warranted.
const buckets = new Map<string, { count: number; reset: number }>()

export function rateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): boolean {
  // Prune expired entries to bound memory, but only on a small fraction of calls
  // — a full Map scan on every call is O(N) per request → O(N²) over a
  // burst from N distinct IPs. Correctness never depends on this sweep: the
  // current key's own expired entry is always reset by the check below. Sampled
  // like dbRateLimit's opportunistic prune.
  if (Math.random() < 0.02) {
    for (const [k, v] of Array.from(buckets.entries())) {
      if (now > v.reset) buckets.delete(k)
    }
  }
  const entry = buckets.get(key)
  if (!entry || now > entry.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs })
    return true
  }
  if (entry.count >= limit) return false
  entry.count++
  return true
}

// Test-only: clears all buckets so cases start from a clean slate.
export function __resetRateLimit(): void {
  buckets.clear()
}
