// fiscalYear reads FY_START_MONTH from appConfig at load; override via env +
// resetModules + re-require (same pattern as appConfig.test).
describe("fiscalYear", () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL }
    jest.resetModules()
  })
  const load = (month?: string) => {
    process.env = { ...ORIGINAL, APP_FY_START_MONTH: month }
    jest.resetModules()
    return require("@/lib/fiscalYear")
  }

  describe("default (July start, AU convention)", () => {
    const { currentFYYear, fyDateRange } = require("@/lib/fiscalYear")
    it("Jul 2025 → FY 2025; Jun 2025 → FY 2024", () => {
      expect(currentFYYear(new Date("2025-07-01T00:00:00Z"))).toBe(2025)
      expect(currentFYYear(new Date("2025-06-30T00:00:00Z"))).toBe(2024)
    })
    it("range is 1 Jul → 1 Jul next (UTC, half-open)", () => {
      const { start, end } = fyDateRange(2025)
      expect(start.toISOString()).toBe("2025-07-01T00:00:00.000Z")
      expect(end.toISOString()).toBe("2026-07-01T00:00:00.000Z")
    })
  })

  describe("FY_START_MONTH=1 (calendar-year FY)", () => {
    it("every month maps to its own calendar year", () => {
      const { currentFYYear, fyDateRange } = load("1")
      expect(currentFYYear(new Date("2025-01-01T00:00:00Z"))).toBe(2025)
      expect(currentFYYear(new Date("2025-12-31T00:00:00Z"))).toBe(2025)
      const { start, end } = fyDateRange(2025)
      expect(start.toISOString()).toBe("2025-01-01T00:00:00.000Z")
      expect(end.toISOString()).toBe("2026-01-01T00:00:00.000Z")
    })
  })

  describe("FY_START_MONTH=4 (April–March)", () => {
    it("Apr–Dec → current year, Jan–Mar → prior year", () => {
      const { currentFYYear, fyDateRange } = load("4")
      expect(currentFYYear(new Date("2025-04-01T00:00:00Z"))).toBe(2025)
      expect(currentFYYear(new Date("2025-03-31T00:00:00Z"))).toBe(2024)
      const { start, end } = fyDateRange(2025)
      expect(start.toISOString()).toBe("2025-04-01T00:00:00.000Z")
      expect(end.toISOString()).toBe("2026-04-01T00:00:00.000Z")
    })
  })
})
