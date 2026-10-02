import { schedulerEnabled } from "@/lib/schedulerFlag"

describe("schedulerEnabled in demo mode", () => {
  it("is off even when IN_APP_CRON=true", () => {
    expect(schedulerEnabled({ DEMO_MODE: "true", IN_APP_CRON: "true", NODE_ENV: "production" })).toBe(false)
  })
  it("is unchanged when DEMO_MODE is unset", () => {
    expect(schedulerEnabled({ NODE_ENV: "production" })).toBe(true)
  })
})
