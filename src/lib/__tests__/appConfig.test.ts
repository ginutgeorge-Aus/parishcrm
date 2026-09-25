// appConfig reads env at MODULE LOAD, so every override test must set
// process.env THEN jest.resetModules() THEN re-require the module.
describe("appConfig", () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL }
    delete window.__APP_CONFIG__
    jest.resetModules()
  })

  const load = (env: Record<string, string | undefined>) => {
    process.env = { ...ORIGINAL, ...env }
    jest.resetModules()
    return require("@/lib/appConfig")
  }

  it("defaults to AU values when env unset", () => {
    const c = load({
      APP_FY_START_MONTH: undefined,
      APP_TIMEZONE: undefined,
      APP_LOCALE: undefined,
      APP_CURRENCY: undefined,
    })
    expect(c.FY_START_MONTH).toBe(7)
    expect(c.APP_TIMEZONE).toBe("Australia/Sydney")
    expect(c.APP_LOCALE).toBe("en-AU")
    expect(c.APP_CURRENCY).toBe("AUD")
  })

  it("parses valid overrides", () => {
    const c = load({
      APP_FY_START_MONTH: "1",
      APP_TIMEZONE: "America/New_York",
      APP_LOCALE: "en-US",
      APP_CURRENCY: "USD",
    })
    expect(c.FY_START_MONTH).toBe(1)
    expect(c.APP_TIMEZONE).toBe("America/New_York")
    expect(c.APP_LOCALE).toBe("en-US")
    expect(c.APP_CURRENCY).toBe("USD")
  })

  it("throws on FY_START_MONTH out of range or non-integer", () => {
    expect(() => load({ APP_FY_START_MONTH: "0" })).toThrow(/FY_START_MONTH/)
    expect(() => load({ APP_FY_START_MONTH: "13" })).toThrow(/FY_START_MONTH/)
    expect(() => load({ APP_FY_START_MONTH: "x" })).toThrow(/FY_START_MONTH/)
  })

  it("throws on invalid IANA timezone", () => {
    expect(() => load({ APP_TIMEZONE: "Mars/Olympus" })).toThrow(/APP_TIMEZONE/)
  })

  it("throws on structurally invalid locale (underscore typo)", () => {
    expect(() => load({ APP_LOCALE: "en_US" })).toThrow(/APP_LOCALE/)
  })

  it("throws on non-3-letter currency", () => {
    expect(() => load({ APP_CURRENCY: "US" })).toThrow(/APP_CURRENCY/)
    expect(() => load({ APP_CURRENCY: "usd" })).toThrow(/APP_CURRENCY/)
  })

  it("reads TURNSTILE_SITE_KEY at runtime; unset → undefined", () => {
    expect(load({ TURNSTILE_SITE_KEY: "site-key" }).TURNSTILE_SITE_KEY).toBe("site-key")
    expect(load({ TURNSTILE_SITE_KEY: undefined }).TURNSTILE_SITE_KEY).toBeUndefined()
  })

  it("falls back to the deprecated NEXT_PUBLIC_TURNSTILE_SITE_KEY name", () => {
    expect(load({ TURNSTILE_SITE_KEY: undefined, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "legacy" }).TURNSTILE_SITE_KEY).toBe("legacy")
    expect(load({ TURNSTILE_SITE_KEY: "new", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "legacy" }).TURNSTILE_SITE_KEY).toBe("new")
  })

  // Browser path: the root layout injects the server's resolved config as
  // window.__APP_CONFIG__, so one published image serves any region.
  it("prefers window.__APP_CONFIG__ over process.env when injected", () => {
    window.__APP_CONFIG__ = {
      fyStartMonth: 4,
      timezone: "Europe/London",
      locale: "en-GB",
      currency: "GBP",
      turnstileSiteKey: "from-window",
    }
    const c = load({ APP_TIMEZONE: "America/New_York", TURNSTILE_SITE_KEY: "from-env" })
    expect(c.FY_START_MONTH).toBe(4)
    expect(c.APP_TIMEZONE).toBe("Europe/London")
    expect(c.APP_LOCALE).toBe("en-GB")
    expect(c.APP_CURRENCY).toBe("GBP")
    expect(c.TURNSTILE_SITE_KEY).toBe("from-window")
  })

  it("publicAppConfig() round-trips through the browser path", () => {
    const server = load({
      APP_FY_START_MONTH: "1",
      APP_TIMEZONE: "America/New_York",
      APP_LOCALE: "en-US",
      APP_CURRENCY: "USD",
      TURNSTILE_SITE_KEY: "k",
    })
    window.__APP_CONFIG__ = JSON.parse(JSON.stringify(server.publicAppConfig()))
    const client = load({})
    expect(client.FY_START_MONTH).toBe(1)
    expect(client.APP_TIMEZONE).toBe("America/New_York")
    expect(client.APP_LOCALE).toBe("en-US")
    expect(client.APP_CURRENCY).toBe("USD")
    expect(client.TURNSTILE_SITE_KEY).toBe("k")
  })
})
