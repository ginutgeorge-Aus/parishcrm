/** @jest-environment node */
import {
  createWebhookFailureTracker,
  FAILURE_WINDOW_MS,
  ALERT_COOLDOWN_MS,
} from "@/lib/stripeWebhookAlert"

jest.mock("@/lib/prisma", () => ({ prisma: {} }))
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }))
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
