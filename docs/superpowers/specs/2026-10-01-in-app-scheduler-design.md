# In-app scheduler — design

Date: 2026-10-01 · Status: proposed

## Goal

Run every background job inside the app process, so a deployment needs no
external scheduler (Railway cron service, Azure cron job, GitHub Actions
schedule or crontab). The Railway template shrinks to app + Postgres.

The four `/api/cron/*` routes stay as a manual trigger and as a fallback for
hosts where the app does not stay running.

## Non-goals

- Distributed leader election. The app runs as one replica (the in-memory rate
  limiter already assumes this). Jobs are already safe to run twice; see
  "Multiple replicas".
- Cron-expression parsing or a job-scheduling library. Four fixed schedules
  don't need one.
- Persisting scheduler state. The jobs' own DB markers (`reminderSentAt`,
  `CelebrationSend` claims, the issue fingerprint marker) already prevent
  duplicate work after a restart.

## Switch

`IN_APP_CRON`:

| Value | Behaviour |
|---|---|
| unset | on when `NODE_ENV=production`, off otherwise (so `npm run dev` never emails real people from a dev DB) |
| `true` | on (including in dev) |
| `false` | off; use the cron routes from an external scheduler |

The scheduler starts only in the Node runtime and never under Jest.

## Jobs and schedules

All times are Sydney wall-clock, using `src/lib/dates.ts`. That fixes the
hard-coded 21:00 UTC, which drifts by an hour across daylight saving.

| Job | Function | Due when | Skip when |
|---|---|---|---|
| `reminders` | `runReminderSweep(now)` | at least 30 min since its last start | — |
| `checkouts` | `sweepExpiredCheckouts()` | at least 30 min since its last start | — |
| `celebrations` | `runCelebrationSweep(now)` | Sydney time is 07:00 or later and there has been no successful run today (Sydney date) | — |
| `errorDigest` | `runErrorDigest(now)` | Sydney Monday 09:00 or later and there has been no successful run this Sydney week | `GITHUB_TOKEN` or `GITHUB_REPO` unset |

A failed `celebrations` or `errorDigest` run is retried on the next tick and
keeps retrying for the rest of the day or week. The existing claims and
fingerprints prevent duplicates. Unlike today's single 21:00 UTC call, a slow
or down app still sends that day's birthday emails once it recovers.

## Architecture

```
instrumentation.ts register()
  └─ after env + keyring checks: if schedulerEnabled() → startScheduler()

src/lib/scheduler.ts        (pure, no I/O)
  JOBS: { name, isDue(now, state) }[]
  dueJobs(now, state) → names
  schedulerEnabled(env) → boolean

src/lib/schedulerRunner.ts  (timer + side effects)
  startScheduler()  — globalThis guard (one timer per process, survives dev HMR)
  tick(now)         — for each due job not already running: run, record state
  setInterval(tick, 5 min).unref(); first tick 60 s after boot
```

`state` lives in memory, one record per job: `lastStart`, `lastSuccessDay`,
`lastSuccessWeek` and `running`.

### Refactor of existing sweeps

`sendDueReminders(authorization, now)` and `sendDueCelebrations(authorization, now)`
check `CRON_SECRET` and the bearer token before doing the work. Split each one:

- `runReminderSweep(now)` / `runCelebrationSweep(now)`: the work, no auth.
- `sendDueReminders` / `sendDueCelebrations`: unchanged signatures and
  responses. They check auth, then call the run function.

The routes don't change. The scheduler calls the run functions directly, so
it never builds a fake `Authorization` header and doesn't need `CRON_SECRET`.

## Error handling

- Each job runs in its own `try/catch`. A throw is logged and recorded as a
  failure, and the next tick retries it. It never crashes the process or blocks
  the other jobs.
- No overlap: a job still `running` from an earlier tick is skipped.
- The timer is `unref()`'d, so it never holds the process open on shutdown. An
  interrupted run is covered by the existing leases (reminders, celebrations).
- Logs are one JSON line per run, written with `console.log`/`console.error` so
  App Insights picks them up:
  `{ level, source: "scheduler", job, ms, result }`. `result` holds only counts,
  never names or email addresses.

## Multiple replicas

Each replica would run its own timer. The jobs are already safe to run in
parallel: reminder leases, celebration claims, the checkout sweep (an
idempotent update) and the digest fingerprint check. `envCheck` gains a boot
warning when the scheduler is on and `CONTAINER_APP_REPLICA_COUNT > 1`.

## Testing (TDD)

- `scheduler.test.ts` (pure):
  - each job's `isDue` at its boundaries;
  - celebrations before and after 07:00 Sydney, on both daylight-saving
    changeover days;
  - the digest on Monday versus Sunday, and its week rollover;
  - the digest skipped without GitHub env;
  - `schedulerEnabled` for every row of the switch table.
- `schedulerRunner.test.ts` (fake timers, mocked jobs):
  - the first tick at 60 s;
  - due jobs run;
  - a running job is not started again;
  - a throwing job doesn't stop the others, and is retried on the next tick;
  - the `globalThis` guard means a second `startScheduler()` starts no second
    timer.
- `instrumentation.test.ts`: the scheduler starts when enabled and not when
  disabled.
- The existing `reminderSweep` and `celebrationSweep` route tests stay green
  without changes, which proves the auth split preserved behaviour.

## Docs and rollout

1. Docs:
   - `docs/environment.md`: add `IN_APP_CRON`.
   - `docs/deploy/railway.md`: "Scheduled jobs" becomes "Jobs run inside the
     app; nothing to set up". Remove the cron-service steps and troubleshooting
     rows. Keep the external-scheduler fallback.
   - `docs/self-hosting.md`: the cron routes become optional, needed only when
     `IN_APP_CRON=false` or the host scales to zero.
   - Root `CLAUDE.md` (local only): update the "Background jobs" line.
2. Release, then the owner does two manual steps:
   - Railway template editor: delete the `cron` service.
   - Azure: delete the external cron jobs. Running both during the switch is
     harmless.

## Risks

| Risk | Mitigation |
|---|---|
| A host that sleeps idle apps never fires the timer | Documented. Set `IN_APP_CRON=false` and use the routes |
| Jobs run twice during the switch while external crons still exist | Every job is idempotent. Remove the external crons after the release |
| Dev sends real emails | Off by default unless `NODE_ENV=production` |
