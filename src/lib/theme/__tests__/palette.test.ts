/**
 * Theme palette — single source for server-rendered brand colours (PDFs, emails,
 * OTP, print pages, manifest/theme-color). Neutral monochrome-slate defaults; a
 * deploy restores its own colours via THEME_* env, zero source edits (OSS Phase 2).
 */
describe("theme/palette", () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...OLD_ENV }
    delete process.env.THEME_PRIMARY
    delete process.env.THEME_PRIMARY_DARK
    delete process.env.THEME_ACCENT
  })

  afterAll(() => {
    process.env = OLD_ENV
  })

  it("uses neutral monochrome-slate defaults when no THEME_* env is set", async () => {
    const p = await import("../palette")
    expect(p.PRIMARY_HEX).toBe("#1e293b") // slate-800
    expect(p.ACCENT_HEX).toBe("#94a3b8") // slate-400 — visible rule/emphasis
    // Band falls back to primary when THEME_PRIMARY_DARK is unset.
    expect(p.PRIMARY_DARK_HEX).toBe("#1e293b")
  })

  it("overrides brand hex from THEME_* env (navy/gold brand)", async () => {
    process.env.THEME_PRIMARY = "#1e293b"
    process.env.THEME_PRIMARY_DARK = "#1e3a5f"
    process.env.THEME_ACCENT = "#c8a24a"
    const p = await import("../palette")
    expect(p.PRIMARY_HEX).toBe("#1e293b")
    expect(p.PRIMARY_DARK_HEX).toBe("#1e3a5f")
    expect(p.ACCENT_HEX).toBe("#c8a24a")
  })

  it("normalizes env hex to canonical lowercase #RRGGBB for PDF/email/manifest consumers", async () => {
    process.env.THEME_PRIMARY = "1e293b" // no leading #
    process.env.THEME_ACCENT = "#C8A24A" // uppercase
    const p = await import("../palette")
    expect(p.PRIMARY_HEX).toBe("#1e293b")
    expect(p.ACCENT_HEX).toBe("#c8a24a")
  })

  it("falls back to the neutral default when an env value is malformed", async () => {
    process.env.THEME_PRIMARY = "not-a-colour"
    process.env.THEME_ACCENT = "#12" // too short
    const p = await import("../palette")
    expect(p.PRIMARY_HEX).toBe("#1e293b")
    expect(p.ACCENT_HEX).toBe("#94a3b8")
  })

  it("band inherits THEME_PRIMARY when THEME_PRIMARY_DARK is unset", async () => {
    process.env.THEME_PRIMARY = "#112233"
    const p = await import("../palette")
    expect(p.PRIMARY_DARK_HEX).toBe("#112233")
  })

  it("exposes theme-independent slate/semantic neutrals", async () => {
    const p = await import("../palette")
    expect(p.SLATE_700).toBe("#334155")
    expect(p.SLATE_500).toBe("#64748b")
    expect(p.SLATE_400).toBe("#94a3b8")
    expect(p.GREEN).toBe("#16a34a")
  })

  describe("parseHex", () => {
    it("canonicalizes valid hex (with/without #, any case) to lowercase #RRGGBB", async () => {
      const { parseHex } = await import("../palette")
      expect(parseHex("#1E293B")).toBe("#1e293b")
      expect(parseHex("c8a24a")).toBe("#c8a24a")
    })

    it("returns null for absent or malformed values so the layout drops the override", async () => {
      const { parseHex } = await import("../palette")
      expect(parseHex(undefined)).toBeNull()
      expect(parseHex("")).toBeNull()
      expect(parseHex("#12")).toBeNull()
      expect(parseHex("not-a-colour")).toBeNull()
    })
  })

  describe("hexToHslTriple", () => {
    it("converts brand navy to the globals.css --primary triple", async () => {
      const { hexToHslTriple } = await import("../palette")
      expect(hexToHslTriple("#1e293b")).toBe("217 33% 17%")
    })

    it("accepts hex without a leading #", async () => {
      const { hexToHslTriple } = await import("../palette")
      expect(hexToHslTriple("1e293b")).toBe("217 33% 17%")
    })

    it("converts pure white and black", async () => {
      const { hexToHslTriple } = await import("../palette")
      expect(hexToHslTriple("#ffffff")).toBe("0 0% 100%")
      expect(hexToHslTriple("#000000")).toBe("0 0% 0%")
    })

    it("falls back to the neutral primary triple on malformed input", async () => {
      const { hexToHslTriple } = await import("../palette")
      expect(hexToHslTriple("nope")).toBe("217 33% 17%")
    })
  })
})
