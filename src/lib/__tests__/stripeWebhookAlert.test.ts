/** @jest-environment node */
import {
  createWebhookFailureTracker,
  FAILURE_WINDOW_MS,
  ALERT_COOLDOWN_MS,
} from "@/lib/stripeWebhookAlert"

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: jest.fn() },
    appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
  },
}))
jest.mock("@/lib/email", () => ({
  sendEmail: jest.fn(),
  isAmbiguousDeliveryError: jest.fn((e: { code?: string }) => e?.code === "ETIMEDOUT"),
}))
jest.mock("@/lib/emailTemplateStore", () => ({ getChurchName: jest.fn() }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn() } }))

const { logger } = require("@/lib/logger")

function setup(initialLast: number | null = null) {
  let clock = 1_000_000
  let last = initialLast
  const sendAlert = jest.fn().mockResolvedValue(undefined)
  const setLastSentAt = jest.fn(async (ms: number) => { last = ms })
  const record = createWebhookFailureTracker({
    now: () => clock,
    getLastSentAt: async () => last,
    setLastSentAt,
    sendAlert,
  })
  return { record, sendAlert, setLastSentAt, advance: (ms: number) => { clock += ms } }
}

beforeEach(() => jest.clearAllMocks())

it("does not email below the threshold", async () => {
  const t = setup()
  await t.record()
  await t.record()
  expect(t.sendAlert).not.toHaveBeenCalled()
})

it("emails once on the 3rd failure in the window and persists the timestamp", async () => {
  const t = setup()
  await t.record()
  await t.record()
  await t.record()
  expect(t.sendAlert).toHaveBeenCalledTimes(1)
  expect(t.setLastSentAt).toHaveBeenCalledTimes(1)
})

it("does not email again for failures within the cooldown", async () => {
  const t = setup()
  for (let i = 0; i < 3; i++) await t.record()
  for (let i = 0; i < 5; i++) await t.record()
  t.advance(ALERT_COOLDOWN_MS - 1000)
  for (let i = 0; i < 5; i++) await t.record()
  expect(t.sendAlert).toHaveBeenCalledTimes(1)
})

it("emails again after the cooldown expires", async () => {
  const t = setup()
  for (let i = 0; i < 3; i++) await t.record()
  t.advance(ALERT_COOLDOWN_MS + 1)
  for (let i = 0; i < 3; i++) await t.record()
  expect(t.sendAlert).toHaveBeenCalledTimes(2)
})

it("respects a persisted cooldown after restart", async () => {
  const t = setup(1_000_000 - 1000)
  for (let i = 0; i < 4; i++) await t.record()
  expect(t.sendAlert).not.toHaveBeenCalled()
})

it("resets the count when the window expires", async () => {
  const t = setup()
  await t.record()
  await t.record()
  t.advance(FAILURE_WINDOW_MS + 1)
  await t.record()
  expect(t.sendAlert).not.toHaveBeenCalled()
  await t.record()
  await t.record()
  expect(t.sendAlert).toHaveBeenCalledTimes(1)
})

it("swallows send errors and logs them", async () => {
  const t = setup()
  t.sendAlert.mockRejectedValue(new Error("smtp down"))
  await t.record()
  await t.record()
  await expect(t.record()).resolves.toBeUndefined()
  expect(logger.error).toHaveBeenCalled()
  expect(t.setLastSentAt).not.toHaveBeenCalled()
})

it("caps retained failures during cooldown (no growth, still one alert)", async () => {
  const t = setup()
  for (let i = 0; i < 3; i++) await t.record()
  for (let i = 0; i < 50; i++) await t.record()
  expect(t.sendAlert).toHaveBeenCalledTimes(1)
})

describe("default tracker (prisma + email wiring)", () => {
  const { prisma } = require("@/lib/prisma")
  const { sendEmail } = require("@/lib/email")
  const { getChurchName } = require("@/lib/emailTemplateStore")

  /** Loads a fresh module so the in-memory tracker state is clean. */
  function load(): { recordWebhookVerificationFailure: () => void } {
    let mod: { recordWebhookVerificationFailure: () => void } | undefined
    jest.isolateModules(() => { mod = require("@/lib/stripeWebhookAlert") })
    return mod!
  }
  const flush = () => new Promise((r) => setImmediate(r))
  async function fire(n: number, mod = load()) {
    for (let i = 0; i < n; i++) { mod.recordWebhookVerificationFailure(); await flush(); await flush() }
  }

  beforeEach(() => {
    prisma.appSetting.findUnique.mockResolvedValue(null)
    prisma.appSetting.upsert.mockResolvedValue({})
    prisma.user.findMany.mockResolvedValue([{ email: " a@example.com " }, { email: "a@example.com" }, { email: "b@example.com" }])
    sendEmail.mockResolvedValue(undefined)
    getChurchName.mockResolvedValue("Test <Church>")
  })

  it("emails each distinct admin once with escaped HTML and stores the timestamp", async () => {
    await fire(3)
    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(sendEmail.mock.calls[0][0]).toBe("a@example.com")
    expect(sendEmail.mock.calls[0][2]).toContain("Test &lt;Church&gt;")
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "stripeWebhookAlertLastSentAt" } }),
    )
  })

  it("honours a persisted last-sent time (valid number)", async () => {
    prisma.appSetting.findUnique.mockResolvedValue({ value: String(Date.now()) })
    await fire(3)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("treats a non-numeric stored value as never sent", async () => {
    prisma.appSetting.findUnique.mockResolvedValue({ value: "junk" })
    await fire(3)
    expect(sendEmail).toHaveBeenCalled()
  })

  it("logs and persists nothing when there is no active admin", async () => {
    prisma.user.findMany.mockResolvedValue([])
    await fire(3)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()
  })

  it("persists nothing when every send fails definitively", async () => {
    sendEmail.mockRejectedValue(new Error("smtp 550"))
    await fire(3)
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
  })

  it("counts ambiguous delivery errors as sent so the cooldown persists", async () => {
    sendEmail.mockRejectedValue(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))
    await fire(3)
    expect(prisma.appSetting.upsert).toHaveBeenCalledTimes(1)
  })
})
