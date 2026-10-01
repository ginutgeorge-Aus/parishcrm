/** @jest-environment node */
import { dueJobs, initialState, schedulerEnabled, successKey, type SchedulerState } from "@/lib/scheduler"

const DIGEST = { GITHUB_TOKEN: "t", GITHUB_REPO: "o/r", ERROR_DIGEST: "true" }
// Thu 2026-07-02 in AEST (UTC+10)
const at = (sydHour: number, min = 0) => new Date(Date.UTC(2026, 6, 1, sydHour + 14, min))
const MIN = 60_000

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
    const s = state({ reminders: { lastStart: at(3).getTime() }, checkouts: { lastStart: at(3).getTime() } })
    expect(dueJobs(at(3, 29), s, {})).toEqual([])
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
  const quiet = { reminders: { running: true }, checkouts: { running: true } }
  it("is not due before 07:00 Sydney", () => {
    expect(dueJobs(at(6, 55), state(quiet), {})).toEqual([])
  })
  it("is due from 07:00 Sydney until it succeeds that day", () => {
    expect(dueJobs(at(7), state(quiet), {})).toEqual(["celebrations"])
    expect(dueJobs(at(15), state(quiet), {})).toEqual(["celebrations"])
  })
  it("is not due again the same Sydney day after a success", () => {
    expect(dueJobs(at(9), state({ ...quiet, celebrations: { lastSuccessKey: "2026-07-02" } }), {})).toEqual([])
  })
  it("backs off 30 min after an unsuccessful attempt", () => {
    const s = state({ ...quiet, celebrations: { lastStart: at(7).getTime() } })
    expect(dueJobs(new Date(at(7).getTime() + 29 * MIN), s, {})).toEqual([])
    expect(dueJobs(new Date(at(7).getTime() + 30 * MIN), s, {})).toEqual(["celebrations"])
  })
  it("uses Sydney time under daylight saving (AEDT, UTC+11)", () => {
    // 2027-01-07 19:59 UTC = 06:59 AEDT; 20:00 UTC = 07:00 AEDT
    expect(dueJobs(new Date("2027-01-07T19:59:00Z"), state(quiet), {})).toEqual([])
    expect(dueJobs(new Date("2027-01-07T20:00:00Z"), state(quiet), {})).toEqual(["celebrations"])
  })
})

describe("dueJobs — errorDigest", () => {
  const quiet = { reminders: { running: true }, checkouts: { running: true }, celebrations: { running: true } }
  // Mon 2026-07-06 Sydney hour h (AEST)
  const mon = (h: number) => new Date(Date.UTC(2026, 6, 5, h + 14))
  it("is skipped unless ERROR_DIGEST=true (GITHUB_TOKEN alone is the feedback widget)", () => {
    expect(dueJobs(mon(10), state(quiet), { GITHUB_TOKEN: "t", GITHUB_REPO: "o/r" })).toEqual([])
  })
  it("is skipped without GitHub config even when opted in", () => {
    expect(dueJobs(mon(10), state(quiet), { ERROR_DIGEST: "true" })).toEqual([])
  })
  it("is not due on Monday before 09:00 Sydney", () => {
    expect(dueJobs(mon(8), state(quiet), DIGEST)).toEqual([])
  })
  it("is due on Monday from 09:00 Sydney", () => {
    expect(dueJobs(mon(9), state(quiet), DIGEST)).toEqual(["errorDigest"])
  })
  it("is due later in the week if it has not succeeded this week", () => {
    expect(dueJobs(at(3), state(quiet), DIGEST)).toEqual(["errorDigest"])
  })
  it("is not due again the same week after a success", () => {
    expect(dueJobs(at(3), state({ ...quiet, errorDigest: { lastSuccessKey: "2026-06-29" } }), DIGEST)).toEqual([])
  })
})

describe("successKey", () => {
  it("is the Sydney day for celebrations and the Sydney week for the digest", () => {
    expect(successKey("celebrations", at(9))).toBe("2026-07-02")
    expect(successKey("errorDigest", at(9))).toBe("2026-06-29")
  })
  it("is null for interval jobs", () => {
    expect(successKey("reminders", at(9))).toBeNull()
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
