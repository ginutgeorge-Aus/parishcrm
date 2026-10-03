// Dependency-free on purpose: envCheck imports this, and envCheck must load even
// when appConfig would throw on bad regional env (it reports that error instead).
export type Env = Record<string, string | undefined>

/** `IN_APP_CRON=true|false` forces it; unset = on in production only, so dev never emails real people. */
export function schedulerEnabled(env: Env = process.env): boolean {
  // Live demo: never run jobs (no email to send, and the free host sleeps anyway).
  // Inlined (not isDemoMode) to keep this module dependency-free.
  if (env.DEMO_MODE === "true") return false

  if (env.IN_APP_CRON === "true") return true
  if (env.IN_APP_CRON === "false") return false
  return env.NODE_ENV === "production"
}
