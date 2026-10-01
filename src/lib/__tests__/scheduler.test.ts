/** @jest-environment node */
import { dueJobs, initialState, schedulerEnabled, type SchedulerState } from "@/lib/scheduler"

const GH = { GITHUB_TOKEN: "t", GITHUB_REPO: "o/r" }
// Thu 2026-07-02 in AEST (UTC+10)
const at = (sydHour: number, min = 0) => new Date(Date.UTC(2026, 6, 1, sydHour + 14, min))

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
