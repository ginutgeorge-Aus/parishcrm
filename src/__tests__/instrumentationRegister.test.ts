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
