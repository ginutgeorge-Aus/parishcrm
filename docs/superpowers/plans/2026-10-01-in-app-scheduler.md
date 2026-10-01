# In-app Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run reminders, checkout sweep, celebrations and the error digest from a timer inside the app, so a deployment needs no external scheduler.

**Architecture:** `register()` in `src/instrumentation.ts` starts a 5-minute `setInterval` (`src/lib/schedulerRunner.ts`). Each tick asks a pure function (`src/lib/scheduler.ts`) which jobs are due, using Sydney wall-clock and in-memory state, then runs them one after another with error isolation. The reminder and celebration sweeps get an auth-free `run*` entry point; the routes keep their auth.

**Tech Stack:** Next.js 16 instrumentation hook, TypeScript, Jest 30 (fake timers), `Intl.DateTimeFormat` for timezone maths. No new dependencies.

Spec: `docs/superpowers/specs/2026-10-01-in-app-scheduler-design.md`

## Global Constraints

- No new npm dependencies.
- `IN_APP_CRON`: `true` means on, `false` means off, unset means on only when `NODE_ENV=production`.
- Tick every 5 min; first tick 60 s after boot; the timer is `unref()`'d.
- Sydney times come from `APP_TIMEZONE` via `src/lib/dates.ts`. Never hard-code UTC hours.
- Logs: one JSON line per job run, `source: "scheduler"`, counts only (no names or emails).
- Route behaviour and responses stay unchanged; existing route and sweep tests must pass unmodified.
- Run single suites with `npm test -- --testPathPatterns="<name>"`.

---

### Task 1: Sydney clock helpers

**Files:**
- Modify: `src/lib/dates.ts` (append after `sydneyToday`)
- Test: `src/lib/__tests__/datesClock.test.ts` (create)

**Interfaces:**
- Produces: `sydneyClock(at?: Date): { ymd: string; hour: number; weekday: number }` (weekday 1 = Monday … 7 = Sunday), `sydneyWeekStartYMD(at?: Date): string` (the Monday `YYYY-MM-DD` of that Sydney week).

- [ ] **Step 1: Write the failing test** — `src/lib/__tests__/datesClock.test.ts`

```ts
/** @jest-environment node */
import { sydneyClock, sydneyWeekStartYMD } from "@/lib/dates"

describe("sydneyClock", () => {
  it("reads Sydney wall-clock in AEST (UTC+10)", () => {
    // 2026-07-01 21:30 UTC = Thu 2026-07-02 07:30 AEST
    expect(sydneyClock(new Date("2026-07-01T21:30:00Z"))).toEqual({ ymd: "2026-07-02", hour: 7, weekday: 4 })
  })
  it("reads Sydney wall-clock in AEDT (UTC+11)", () => {
    // 2026-12-31 20:15 UTC = Fri 2027-01-01 07:15 AEDT
    expect(sydneyClock(new Date("2026-12-31T20:15:00Z"))).toEqual({ ymd: "2027-01-01", hour: 7, weekday: 5 })
  })
  it("reports midnight as hour 0", () => {
    // 2026-07-05 14:00 UTC = Mon 2026-07-06 00:00 AEST
    expect(sydneyClock(new Date("2026-07-05T14:00:00Z"))).toEqual({ ymd: "2026-07-06", hour: 0, weekday: 1 })
  })
})

describe("sydneyWeekStartYMD", () => {
  it("returns the same day on a Monday", () => {
    expect(sydneyWeekStartYMD(new Date("2026-07-05T14:00:00Z"))).toBe("2026-07-06")
  })
  it("returns the previous Monday on a Sunday, across a month boundary", () => {
    // 2026-08-02 02:00 UTC = Sun 2026-08-02 12:00 AEST
    expect(sydneyWeekStartYMD(new Date("2026-08-02T02:00:00Z"))).toBe("2026-07-27")
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- --testPathPatterns="datesClock"`
Expected: FAIL, `sydneyClock is not a function`.

- [ ] **Step 3: Implement** by appending to `src/lib/dates.ts` after `sydneyToday`:

```ts
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** Sydney wall-clock for an instant: date, hour (0–23) and ISO weekday (1 = Monday … 7 = Sunday). */
export function sydneyClock(at: Date = new Date()): { ymd: string; hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(at)
  const hour = Number(parts.find((p) => p.type === "hour")!.value)
  const weekday = WEEKDAYS.indexOf(parts.find((p) => p.type === "weekday")!.value) + 1
  return { ymd: sydneyTodayYMD(at), hour, weekday }
}

/** The Monday (`YYYY-MM-DD`) that starts the Sydney week containing `at`. */
export function sydneyWeekStartYMD(at: Date = new Date()): string {
  const { ymd, weekday } = sydneyClock(at)
  const d = new Date(ymd + "T00:00:00.000Z")
  d.setUTCDate(d.getUTCDate() - (weekday - 1))
  return d.toISOString().slice(0, 10)
}
```

- [ ] **Step 4: Run it and confirm it passes.** Run: `npm test -- --testPathPatterns="datesClock"`. Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates.ts src/lib/__tests__/datesClock.test.ts
git commit -m "feat(dates): add sydneyClock and sydneyWeekStartYMD"
```

---

### Task 2: Pure schedule (`scheduler.ts`)

**Files:**
- Create: `src/lib/scheduler.ts`
- Test: `src/lib/__tests__/scheduler.test.ts`

**Interfaces:**
- Consumes: `sydneyClock`, `sydneyWeekStartYMD` (Task 1).
- Produces:
  - `type JobName = "reminders" | "checkouts" | "celebrations" | "errorDigest"`
  - `type JobState = { lastStart: number | null; lastSuccessDay: string | null; lastSuccessWeek: string | null; running: boolean }`
  - `type SchedulerState = Record<JobName, JobState>`
  - `JOB_NAMES: readonly JobName[]`
  - `initialState(): SchedulerState`
  - `type Env = Record<string, string | undefined>`
  - `dueJobs(now: Date, state: SchedulerState, env?: Env): JobName[]`
  - `schedulerEnabled(env?: Env): boolean`

- [ ] **Step 1: Write the failing test** — `src/lib/__tests__/scheduler.test.ts`

```ts
/** @jest-environment node */
import { dueJobs, initialState, schedulerEnabled, type SchedulerState } from "@/lib/scheduler"

const GH = { GITHUB_TOKEN: "t", GITHUB_REPO: "o/r" }
// Thu 2026-07-02 in AEST (UTC+10)
const at = (sydHour: number, min = 0) => new Date(Date.UTC(2026, 6, 1, sydHour + 14, min) )

function state(patch: Partial<Record<keyof SchedulerState, Partial<SchedulerState["reminders"]>>> = {}): SchedulerState {
  const s = initialState()
  for (const [k, v] of Object.entries(patch)) Object.assign(s[k as keyof SchedulerState], v)
  return s
}

describe("dueJobs — reminders/checkouts", () => {
  it("are due on the first tick", () => {
    expect(dueJobs(at(3), state(), {})).toEqual(["reminders", "checkouts"])
  })
  it("are not due within 30 min of their last start", () => {
    const now = at(3, 29)
    const s = state({ reminders: { lastStart: at(3).getTime() }, checkouts: { lastStart: at(3).getTime() } })
    expect(dueJobs(now, s, {})).toEqual([])
  })
  it("are due again at 30 min", () => {
    const s = state({ reminders: { lastStart: at(3).getTime() }, checkouts: { lastStart: at(3).getTime() } })
    expect(dueJobs(at(3, 30), s, {})).toEqual(["reminders", "checkouts"])
  })
  it("skips a job that is still running", () => {
    expect(dueJobs(at(3), state({ reminders: { running: true } }), {})).toEqual(["checkouts"])
  })
})

describe("dueJobs — celebrations", () => {
  const quiet = { reminders: { lastStart: Number.MAX_SAFE_INTEGER }, checkouts: { lastStart: Number.MAX_SAFE_INTEGER } }
  it("is not due before 07:00 Sydney", () => {
    expect(dueJobs(at(6, 55), state(quiet), {})).toEqual([])
  })
  it("is due from 07:00 Sydney until it succeeds that day", () => {
    expect(dueJobs(at(7), state(quiet), {})).toEqual(["celebrations"])
    expect(dueJobs(at(15), state(quiet), {})).toEqual(["celebrations"])
  })
  it("is not due again the same Sydney day after a success", () => {
    expect(dueJobs(at(9), state({ ...quiet, celebrations: { lastSuccessDay: "2026-07-02" } }), {})).toEqual([])
  })
  it("uses Sydney time under daylight saving (AEDT, UTC+11)", () => {
    // 2027-01-07 19:59 UTC = 06:59 AEDT; 20:00 UTC = 07:00 AEDT
    expect(dueJobs(new Date("2027-01-07T19:59:00Z"), state(quiet), {})).toEqual([])
    expect(dueJobs(new Date("2027-01-07T20:00:00Z"), state(quiet), {})).toEqual(["celebrations"])
  })
})

describe("dueJobs — errorDigest", () => {
  const quiet = {
    reminders: { lastStart: Number.MAX_SAFE_INTEGER },
    checkouts: { lastStart: Number.MAX_SAFE_INTEGER },
    celebrations: { running: true },
  }
  // Mon 2026-07-06 Sydney hour h (AEST)
  const mon = (h: number) => new Date(Date.UTC(2026, 6, 5, h + 14))
  it("is skipped without GitHub config", () => {
    expect(dueJobs(mon(10), state(quiet), {})).toEqual([])
  })
  it("is not due on Monday before 09:00 Sydney", () => {
    expect(dueJobs(mon(8), state(quiet), GH)).toEqual([])
  })
  it("is due on Monday from 09:00 Sydney", () => {
    expect(dueJobs(mon(9), state(quiet), GH)).toEqual(["errorDigest"])
  })
  it("is due later in the week if it has not succeeded this week", () => {
    expect(dueJobs(at(3), state(quiet), GH)).toEqual(["errorDigest"])
  })
  it("is not due again the same week after a success", () => {
    expect(dueJobs(at(3), state({ ...quiet, errorDigest: { lastSuccessWeek: "2026-06-29" } }), GH)).toEqual([])
  })
})

describe("schedulerEnabled", () => {
  it.each([
    [{ IN_APP_CRON: "true", NODE_ENV: "development" }, true],
    [{ IN_APP_CRON: "false", NODE_ENV: "production" }, false],
    [{ NODE_ENV: "production" }, true],
    [{ NODE_ENV: "development" }, false],
    [{ NODE_ENV: "test" }, false],
  ])("%j → %s", (env, expected) => {
    expect(schedulerEnabled(env)).toBe(expected)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails.** Run: `npm test -- --testPathPatterns="lib/__tests__/scheduler.test"`. Expected: FAIL, cannot find module `@/lib/scheduler`.

- [ ] **Step 3: Implement** `src/lib/scheduler.ts`:

```ts
import { sydneyClock, sydneyWeekStartYMD } from "@/lib/dates"

/**
 * Pure schedule for the in-app scheduler (see schedulerRunner.ts). No I/O, so
 * every "is it due?" decision is unit-testable against fixed instants. Times
 * are Sydney wall-clock; the jobs' own DB markers (reminder leases, celebration
 * claims, issue fingerprints) make a repeated run harmless, so this in-memory
 * state only avoids wasted work, it is not what prevents duplicates.
 */
export type JobName = "reminders" | "checkouts" | "celebrations" | "errorDigest"
export type JobState = {
  lastStart: number | null
  lastSuccessDay: string | null
  lastSuccessWeek: string | null
  running: boolean
}
export type SchedulerState = Record<JobName, JobState>
export type Env = Record<string, string | undefined>

export const JOB_NAMES: readonly JobName[] = ["reminders", "checkouts", "celebrations", "errorDigest"]

const EVERY_MS = 30 * 60_000
const CELEBRATIONS_FROM_HOUR = 7
const DIGEST_FROM_HOUR = 9

export function initialState(): SchedulerState {
  const fresh = (): JobState => ({ lastStart: null, lastSuccessDay: null, lastSuccessWeek: null, running: false })
  return { reminders: fresh(), checkouts: fresh(), celebrations: fresh(), errorDigest: fresh() }
}

function isDue(job: JobName, now: Date, s: JobState, env: Env): boolean {
  switch (job) {
    case "reminders":
    case "checkouts":
      return s.lastStart === null || now.getTime() - s.lastStart >= EVERY_MS
    case "celebrations": {
      const c = sydneyClock(now)
      return c.hour >= CELEBRATIONS_FROM_HOUR && s.lastSuccessDay !== c.ymd
    }
    case "errorDigest": {
      if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return false
      if (s.lastSuccessWeek === sydneyWeekStartYMD(now)) return false
      const c = sydneyClock(now)
      return c.weekday > 1 || c.hour >= DIGEST_FROM_HOUR
    }
  }
}

export function dueJobs(now: Date, state: SchedulerState, env: Env = process.env): JobName[] {
  return JOB_NAMES.filter((j) => !state[j].running && isDue(j, now, state[j], env))
}

/** `IN_APP_CRON=true|false` forces it; unset = on in production only, so dev never emails real people. */
export function schedulerEnabled(env: Env = process.env): boolean {
  if (env.IN_APP_CRON === "true") return true
  if (env.IN_APP_CRON === "false") return false
  return env.NODE_ENV === "production"
}
```

- [ ] **Step 4: Run it and confirm it passes.** Run: `npm test -- --testPathPatterns="lib/__tests__/scheduler.test"`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler.ts src/lib/__tests__/scheduler.test.ts
git commit -m "feat(scheduler): add pure job schedule"
```

---

### Task 3: Auth-free sweep entry points

**Files:**
- Modify: `src/lib/reminderSweep.ts` (`sendDueReminders`)
- Modify: `src/lib/celebrationSweep.ts` (`sendDueCelebrations`)
- Test: `src/lib/__tests__/reminderSweep.test.ts`, `src/lib/__tests__/celebrationSweep.test.ts` (append only)

**Interfaces:**
- Produces: `runReminderSweep(now: Date): Promise<{ eventsReminded: number; emailsSent: number; emailsFailed: number }>`, `runCelebrationSweep(now: Date): Promise<Record<string, unknown>>` (the same `{ birthdays, anniversaries }` body the route returns today).

- [ ] **Step 1: Write the failing tests.**

In `reminderSweep.test.ts`, change the import to `import { sendDueReminders, runReminderSweep } from "@/lib/reminderSweep"` and append:

```ts
describe("runReminderSweep (in-app scheduler entry)", () => {
  it("runs without CRON_SECRET or an Authorization header", async () => {
    const orig = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    const { prisma } = jest.requireMock("@/lib/prisma")
    prisma.event.findMany.mockResolvedValueOnce([])
    await expect(runReminderSweep(new Date("2026-07-01T00:00:00Z"))).resolves.toEqual({
      eventsReminded: 0, emailsSent: 0, emailsFailed: 0,
    })
    if (orig !== undefined) process.env.CRON_SECRET = orig
  })
})
```

In `celebrationSweep.test.ts`, add `runCelebrationSweep` to its existing import from `@/lib/celebrationSweep` and append a test that unsets `CRON_SECRET`, calls `runCelebrationSweep(new Date("2026-07-01T00:00:00Z"))` with the file's existing "no candidates" mocks (reuse whatever setup its first 200-status test uses), and asserts the result has `birthdays` and `anniversaries` keys:

```ts
describe("runCelebrationSweep (in-app scheduler entry)", () => {
  it("runs without CRON_SECRET or an Authorization header", async () => {
    const orig = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    const body = await runCelebrationSweep(new Date("2026-07-01T00:00:00Z"))
    expect(body).toHaveProperty("birthdays")
    expect(body).toHaveProperty("anniversaries")
    if (orig !== undefined) process.env.CRON_SECRET = orig
  })
})
```

If the file's default mocks don't resolve, copy the `beforeEach` mock setup from its happy-path test into this `describe`.

- [ ] **Step 2: Run and confirm failure.** Run: `npm test -- --testPathPatterns="(reminder|celebration)Sweep"`. Expected: FAIL, `runReminderSweep is not a function` (and the same for celebrations).

- [ ] **Step 3: Implement** a mechanical split in both files:
  - Rename the body *after* the `bearerOk` line into a new exported function: `export async function runReminderSweep(now: Date)`. It contains everything from the `// Cheap SQL pre-filter` comment to the end. Its last line becomes `return { eventsReminded, emailsSent, emailsFailed }`.
  - `sendDueReminders` keeps its secret and `bearerOk` checks unchanged, then ends with `return { status: 200, body: await runReminderSweep(now) }`.
  - Do the same for celebrations: `export async function runCelebrationSweep(now: Date): Promise<Record<string, unknown>>` holds `readAutoEmailFlags()` through the `{ birthdays, anniversaries }` return. `sendDueCelebrations` ends with `return { status: 200, body: await runCelebrationSweep(now) }`.
  - Add a one-line comment above each `run*` function: `// Auth-free core — called by the cron route (after auth) and the in-app scheduler.`

- [ ] **Step 4: Run and confirm everything passes, old tests included.** Run: `npm test -- --testPathPatterns="(reminder|celebration)Sweep|cron"`. Expected: all pass, with existing tests unmodified.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reminderSweep.ts src/lib/celebrationSweep.ts src/lib/__tests__/reminderSweep.test.ts src/lib/__tests__/celebrationSweep.test.ts
git commit -m "refactor(cron): split auth from reminder and celebration sweeps"
```

---

### Task 4: Timer runner (`schedulerRunner.ts`)

**Files:**
- Create: `src/lib/schedulerRunner.ts`
- Test: `src/lib/__tests__/schedulerRunner.test.ts`

**Interfaces:**
- Consumes: `dueJobs`, `initialState`, `JobName`, `SchedulerState` (Task 2); `sydneyTodayYMD`, `sydneyWeekStartYMD` (Task 1); `runReminderSweep`, `runCelebrationSweep` (Task 3); `sweepExpiredCheckouts`; `runErrorDigest`.
- Produces: `TICK_MS = 300_000`, `FIRST_TICK_MS = 60_000`, `type Jobs = Record<JobName, (now: Date) => Promise<unknown>>`, `tick(state: SchedulerState, jobs: Jobs, now?: Date): Promise<void>`, `startScheduler(jobs?: Jobs): boolean`.

- [ ] **Step 1: Write the failing test** — `src/lib/__tests__/schedulerRunner.test.ts`

```ts
/** @jest-environment node */
import { initialState } from "@/lib/scheduler"
import { tick, startScheduler, FIRST_TICK_MS, TICK_MS, type Jobs } from "@/lib/schedulerRunner"

const NOW = new Date("2026-07-01T17:00:00Z") // Thu 03:00 AEST — only reminders/checkouts due

function jobs(overrides: Partial<Jobs> = {}): Jobs {
  return {
    reminders: jest.fn(async () => ({ eventsReminded: 0 })),
    checkouts: jest.fn(async () => ({ expired: 0 })),
    celebrations: jest.fn(async () => ({})),
    errorDigest: jest.fn(async () => ({})),
    ...overrides,
  }
}

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {})
  jest.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe("tick", () => {
  it("runs due jobs and records their start", async () => {
    const s = initialState(); const j = jobs()
    await tick(s, j, NOW)
    expect(j.reminders).toHaveBeenCalledWith(NOW)
    expect(j.checkouts).toHaveBeenCalled()
    expect(j.celebrations).not.toHaveBeenCalled()
    expect(s.reminders.lastStart).toBe(NOW.getTime())
    expect(s.reminders.running).toBe(false)
  })

  it("isolates a throwing job and logs it without stopping the others", async () => {
    const s = initialState()
    const j = jobs({ reminders: jest.fn(async () => { throw new Error("db down") }) })
    await tick(s, j, NOW)
    expect(j.checkouts).toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"job":"reminders"'))
    expect(s.reminders.running).toBe(false)
  })

  it("records the success day so a daily job is not repeated", async () => {
    const s = initialState(); const j = jobs()
    const seven = new Date("2026-07-01T21:00:00Z") // 07:00 AEST
    await tick(s, j, seven)
    expect(s.celebrations.lastSuccessDay).toBe("2026-07-02")
    await tick(s, j, new Date("2026-07-01T21:05:00Z"))
    expect(j.celebrations).toHaveBeenCalledTimes(1)
  })

  it("does not record success for a failed daily job, so the next tick retries it", async () => {
    const s = initialState()
    const j = jobs({ celebrations: jest.fn(async () => { throw new Error("smtp") }) })
    await tick(s, j, new Date("2026-07-01T21:00:00Z"))
    expect(s.celebrations.lastSuccessDay).toBeNull()
  })

  it("never starts a job twice when ticks overlap", async () => {
    const s = initialState()
    let release!: () => void
    const slow = jest.fn(() => new Promise<void>((r) => { release = r }))
    const j = jobs({ reminders: slow })
    const first = tick(s, j, NOW)
    await tick(s, j, NOW)
    expect(slow).toHaveBeenCalledTimes(1)
    release(); await first
  })

  it("logs counts only", async () => {
    const s = initialState()
    const j = jobs({ reminders: jest.fn(async () => ({ eventsReminded: 2, note: "Alice" })) })
    await tick(s, j, NOW)
    const line = (console.log as jest.Mock).mock.calls.map((c) => c[0]).find((l: string) => l.includes('"job":"reminders"'))
    expect(line).toContain('"eventsReminded":2')
    expect(line).not.toContain("Alice")
  })
})

describe("startScheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW })
    delete (globalThis as Record<string, unknown>).__parishcrmScheduler
  })
  afterEach(() => jest.useRealTimers())

  it("first ticks after 60 s, then every 5 min, and starts only once per process", async () => {
    const j = jobs()
    expect(startScheduler(j)).toBe(true)
    expect(startScheduler(j)).toBe(false)
    await jest.advanceTimersByTimeAsync(FIRST_TICK_MS - 1)
    expect(j.reminders).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1)
    expect(j.reminders).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(TICK_MS * 6) // 30 min later → due again
    expect(j.reminders).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run and confirm failure.** Run: `npm test -- --testPathPatterns="schedulerRunner"`. Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement** `src/lib/schedulerRunner.ts`:

```ts
import { sydneyTodayYMD, sydneyWeekStartYMD } from "@/lib/dates"
import { dueJobs, initialState, type JobName, type SchedulerState } from "@/lib/scheduler"

/**
 * In-app scheduler: one timer per process, started from instrumentation.ts.
 * Replaces external cron services; the /api/cron/* routes remain as manual
 * triggers. Jobs run one after another; each is isolated so a throw is logged
 * and retried on a later tick, never crashing the process.
 */
export const TICK_MS = 5 * 60_000
export const FIRST_TICK_MS = 60_000
export type Jobs = Record<JobName, (now: Date) => Promise<unknown>>

// Dynamic imports keep Prisma/email out of instrumentation's boot path until a job runs.
const DEFAULT_JOBS: Jobs = {
  reminders: async (now) => (await import("@/lib/reminderSweep")).runReminderSweep(now),
  checkouts: async () => (await import("@/lib/checkoutSweep")).sweepExpiredCheckouts(),
  celebrations: async (now) => (await import("@/lib/celebrationSweep")).runCelebrationSweep(now),
  errorDigest: async (now) => (await import("@/lib/errorDigest")).runErrorDigest(now),
}

// Keep only numbers (recursively) so a result can never leak a name or email into logs.
function countsOnly(v: unknown): unknown {
  if (typeof v === "number") return v
  if (!v || typeof v !== "object") return undefined
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    const c = countsOnly(x)
    if (c !== undefined) out[k] = c
  }
  return out
}

async function runJob(name: JobName, state: SchedulerState, fn: Jobs[JobName], now: Date): Promise<void> {
  const s = state[name]
  s.lastStart = now.getTime()
  const t0 = Date.now()
  try {
    const result = await fn(now)
    s.lastSuccessDay = sydneyTodayYMD(now)
    s.lastSuccessWeek = sydneyWeekStartYMD(now)
    console.log(JSON.stringify({ level: "info", source: "scheduler", job: name, ms: Date.now() - t0, result: countsOnly(result) }))
  } catch (err) {
    console.error(JSON.stringify({ level: "error", source: "scheduler", job: name, ms: Date.now() - t0, message: err instanceof Error ? err.message : String(err) }))
  } finally {
    s.running = false
  }
}

export async function tick(state: SchedulerState, jobs: Jobs, now: Date = new Date()): Promise<void> {
  const due = dueJobs(now, state)
  // Claim every due job before awaiting any, so an overlapping tick can't pick one up too.
  for (const name of due) state[name].running = true
  for (const name of due) await runJob(name, state, jobs[name], now)
}

const GUARD = "__parishcrmScheduler"

/** Starts the timer once per process (the globalThis guard survives dev HMR). Returns false if already started. */
export function startScheduler(jobs: Jobs = DEFAULT_JOBS): boolean {
  const g = globalThis as Record<string, unknown>
  if (g[GUARD]) return false
  g[GUARD] = true
  const state = initialState()
  const run = () => void tick(state, jobs)
  setTimeout(() => {
    run()
    setInterval(run, TICK_MS).unref()
  }, FIRST_TICK_MS).unref()
  console.log(JSON.stringify({ level: "info", source: "scheduler", message: "in-app scheduler started" }))
  return true
}
```

- [ ] **Step 4: Run and confirm it passes.** Run: `npm test -- --testPathPatterns="schedulerRunner"`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedulerRunner.ts src/lib/__tests__/schedulerRunner.test.ts
git commit -m "feat(scheduler): add in-process timer runner"
```

---

### Task 5: Wire into boot, plus env warnings

**Files:**
- Modify: `src/instrumentation.ts` (`register()`, after `assertKeyringHealthy()`)
- Modify: `src/lib/envCheck.ts` (`collectEnvWarnings`: the `CRON_SECRET` block and the replica block)
- Test: `src/__tests__/instrumentationRegister.test.ts` (create), `src/lib/__tests__/envCheck.test.ts` (append)

**Interfaces:**
- Consumes: `schedulerEnabled` (Task 2), `startScheduler` (Task 4).

- [ ] **Step 1: Write the failing tests.**

`src/__tests__/instrumentationRegister.test.ts`:

```ts
/** @jest-environment node */
jest.mock("@/lib/envCheck", () => ({ assertRequiredEnv: jest.fn(), collectEnvWarnings: jest.fn(() => []) }))
jest.mock("@/lib/crypto", () => ({ assertKeyringHealthy: jest.fn() }))
const startScheduler = jest.fn()
jest.mock("@/lib/schedulerRunner", () => ({ startScheduler }))

import { register } from "@/instrumentation"

describe("register — in-app scheduler", () => {
  const saved = { ...process.env }
  beforeEach(() => {
    startScheduler.mockClear()
    process.env.NEXT_RUNTIME = "nodejs"
    delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  })
  afterEach(() => { process.env = { ...saved } })

  it("starts the scheduler when IN_APP_CRON=true", async () => {
    process.env.IN_APP_CRON = "true"
    await register()
    expect(startScheduler).toHaveBeenCalledTimes(1)
  })

  it("does not start it when IN_APP_CRON=false", async () => {
    process.env.IN_APP_CRON = "false"
    await register()
    expect(startScheduler).not.toHaveBeenCalled()
  })

  it("does not start it outside the Node runtime", async () => {
    process.env.IN_APP_CRON = "true"
    process.env.NEXT_RUNTIME = "edge"
    await register()
    expect(startScheduler).not.toHaveBeenCalled()
  })
})
```

Append to `src/lib/__tests__/envCheck.test.ts`:

```ts
describe("collectEnvWarnings — in-app scheduler", () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it("does not warn about CRON_SECRET when the in-app scheduler is on", () => {
    delete process.env.CRON_SECRET
    process.env.IN_APP_CRON = "true"
    expect(collectEnvWarnings().some((w) => w.startsWith("CRON_SECRET"))).toBe(false)
  })

  it("warns when the scheduler is on with more than one replica", () => {
    process.env.IN_APP_CRON = "true"
    process.env.CONTAINER_APP_REPLICA_COUNT = "2"
    expect(collectEnvWarnings().some((w) => w.includes("IN_APP_CRON"))).toBe(true)
  })
})
```

(Use the file's existing `collectEnvWarnings` import.)

- [ ] **Step 2: Run and confirm failure.** Run: `npm test -- --testPathPatterns="instrumentationRegister|envCheck"`. Expected: FAIL. The scheduler isn't started, and the new warnings are missing.

- [ ] **Step 3: Implement.**

In `src/instrumentation.ts`, right after `assertKeyringHealthy()`:

```ts
  // In-app scheduler: runs reminders, checkout sweep, celebrations and the
  // error digest on a timer, so no external cron service is needed. Off in dev
  // unless IN_APP_CRON=true; IN_APP_CRON=false hands scheduling back to the
  // /api/cron/* routes.
  const { schedulerEnabled } = await import("@/lib/scheduler")
  if (schedulerEnabled()) {
    const { startScheduler } = await import("@/lib/schedulerRunner")
    startScheduler()
  }
```

In `src/lib/envCheck.ts`, add `import { schedulerEnabled } from "@/lib/scheduler"` at the top. Then:
- Change the `CRON_SECRET` condition to `if (!process.env.CRON_SECRET && !schedulerEnabled())`, and add a comment line: `// With the in-app scheduler on, CRON_SECRET only guards the manual /api/cron/* triggers.`
- Inside the existing `replicas > 1` block, after its push, add:

```ts
    if (schedulerEnabled()) {
      warnings.push(`IN_APP_CRON: the in-app scheduler runs on each of the ${replicas} replicas — jobs are idempotent but run ${replicas}× per slot; set IN_APP_CRON=false on all but one replica`)
    }
```

- [ ] **Step 4: Run and confirm everything passes.** Run: `npm test -- --testPathPatterns="instrumentation|envCheck"`. Expected: all pass, including the old `instrumentation.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/instrumentation.ts src/lib/envCheck.ts src/__tests__/instrumentationRegister.test.ts src/lib/__tests__/envCheck.test.ts
git commit -m "feat(scheduler): start in-app scheduler at boot"
```

---

### Task 6: Docs

**Files:**
- Modify: `docs/environment.md` (App environment table: add an `IN_APP_CRON` row)
- Modify: `docs/deploy/railway.md` (intro line, the "Add the cron service yourself" line, custom-domain `APP_URL` sentence, the whole "Scheduled jobs" section, and the cron rows in Troubleshooting)
- Modify: `docs/self-hosting.md` ("Scheduled jobs (optional)" section)
- Modify (local only, never committed): `CLAUDE.md` "Background jobs" bullet

- [ ] **Step 1: `docs/environment.md`.** Add a row next to `CRON_SECRET`: `IN_APP_CRON` — `true`/`false`. Unset means on in production. Runs reminders, the checkout sweep, celebrations (from 07:00 Sydney) and the Monday error digest inside the app. Set `false` on hosts that scale to zero or sleep idle apps, then call the `/api/cron/*` routes from an external scheduler.

- [ ] **Step 2: `docs/deploy/railway.md`.**
  - Intro: "One-click deploy creates two things: the ParishCRM app and a PostgreSQL database."
  - Remove "Add the cron service yourself…" from the manual-deploy note.
  - Custom domain: drop "(and `APP_URL` on the `cron` service)".
  - Replace the Scheduled jobs section with: "Reminders, abandoned-checkout cleanup and celebration emails run inside the app on a timer, so there's nothing to set up. Keep the app always on (Railway's default; don't enable App Sleeping). To use an outside scheduler instead, set `IN_APP_CRON=false` and call the routes in `docs/self-hosting.md`."
  - Keep the duplicate-send note.
  - Troubleshooting: delete the six `cron`-service rows. Add "Reminders/celebrations never send → App Sleeping enabled → disable it, or set `IN_APP_CRON=false` and use an external scheduler".

- [ ] **Step 3: `docs/self-hosting.md`.** Retitle the section to "Scheduled jobs" and open it with: "Jobs run inside the app by default (`IN_APP_CRON`, see environment.md). Use the routes below only if you set `IN_APP_CRON=false`, for example on a host that scales to zero." Keep the curl block.

- [ ] **Step 4: Local `CLAUDE.md`.** Replace the background-jobs bullet with: "Background jobs run in-process via `src/lib/schedulerRunner.ts` (started in `instrumentation.ts`, toggle `IN_APP_CRON`); the bearer-authed `src/app/api/cron/*` routes remain as manual or external triggers." Don't stage this file.

- [ ] **Step 5: Commit** the docs (not `CLAUDE.md`):

```bash
git add docs/environment.md docs/deploy/railway.md docs/self-hosting.md
git commit -m "docs: jobs run in-app; cron service no longer needed"
```

---

### Task 7: Verify and open the PR

- [ ] Run: `npm test` and `npm run lint`. Expected: all green and the coverage floor met.
- [ ] Push `feat/in-app-scheduler` and open a PR titled `feat: run scheduled jobs inside the app`. The body must list the two post-release owner steps: delete the template's `cron` service, and delete the Azure cron jobs.
