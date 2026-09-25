/** @jest-environment node */
import { createHmac } from "crypto"
import { buildEventPayload, signBody, isAllowedSyncUrl, syncEventToWebsite, syncEventDeletion, resyncAllEvents, isWebsiteSyncConfigured } from "@/lib/websiteSync"
import { prisma } from "@/lib/prisma"

jest.mock("@/lib/prisma", () => ({
  prisma: { event: { findUnique: jest.fn(), findMany: jest.fn() } },
}))

const baseEvent = {
  id: 42,
  title: "Family Camp",
  description: "Annual camp",
  category: "special",
  kind: "one_off",
  date: new Date("2026-07-03T09:00:00.000Z"),
  endDate: new Date("2026-07-05T16:00:00.000Z"),
  recurs: null,
  recursLabel: null,
  startTime: null,
  location: "Camp Site",
  imageUrl: null,
  isPublished: true,
  slug: "family-camp-2026",
  ticketTypes: [{ id: 1 }],
  updatedAt: new Date("2026-06-01T02:03:04.567Z"),
}

describe("buildEventPayload — imageUrl", () => {
  it("includes imageUrl in the payload", () => {
    const payload = buildEventPayload({ ...baseEvent, imageUrl: "https://cdn.example.com/h.jpg" })
    expect(payload.imageUrl).toBe("https://cdn.example.com/h.jpg")
  })

  it("passes through a null imageUrl", () => {
    const payload = buildEventPayload({ ...baseEvent, imageUrl: null })
    expect(payload.imageUrl).toBeNull()
  })
})

describe("buildEventPayload — uploaded-banner imageUrl fallback (Task 6)", () => {
  const OLD = process.env.AUTH_URL
  afterEach(() => { process.env.AUTH_URL = OLD })

  it("falls back to the serve-route banner URL when there is no pasted imageUrl and a banner was uploaded", () => {
    process.env.AUTH_URL = "https://crm.example.org"
    const p = buildEventPayload({ ...baseEvent, imageUrl: null, images: [{ kind: "BANNER" }] })
    expect(p.imageUrl).toBe("https://crm.example.org/api/events/family-camp-2026/image/banner")
  })

  it("prefers a pasted imageUrl over the uploaded banner", () => {
    process.env.AUTH_URL = "https://crm.example.org"
    const p = buildEventPayload({
      ...baseEvent,
      imageUrl: "https://cdn.example.com/h.jpg",
      images: [{ kind: "BANNER" }],
    })
    expect(p.imageUrl).toBe("https://cdn.example.com/h.jpg")
  })

  it("is null when there is no pasted imageUrl, no uploaded banner, and only a POSTER exists", () => {
    process.env.AUTH_URL = "https://crm.example.org"
    const p = buildEventPayload({ ...baseEvent, imageUrl: null, images: [{ kind: "POSTER" }] })
    expect(p.imageUrl).toBeNull()
  })

  it("is null when a banner exists but no base URL is resolvable", () => {
    delete process.env.AUTH_URL
    delete process.env.NEXTAUTH_URL
    const p = buildEventPayload({ ...baseEvent, imageUrl: null, images: [{ kind: "BANNER" }] })
    expect(p.imageUrl).toBeNull()
  })
})

describe("buildEventPayload", () => {
  const OLD = process.env.AUTH_URL
  afterEach(() => { process.env.AUTH_URL = OLD })

  it("maps a one-off event with tickets, setting registerUrl and ISO dates", () => {
    process.env.AUTH_URL = "https://crm.example.org"
    const p = buildEventPayload(baseEvent)
    expect(p.crmId).toBe(42)
    expect(p.kind).toBe("one_off")
    expect(p.date).toBe("2026-07-03T09:00:00.000Z")
    expect(p.endDate).toBe("2026-07-05T16:00:00.000Z")
    expect(p.registerUrl).toBe("https://crm.example.org/e/family-camp-2026")
  })

  it("sends updatedAt (ms precision) as the monotonic revision", () => {
    expect(buildEventPayload(baseEvent).revision).toBe("2026-06-01T02:03:04.567Z")
  })

  it("maps a recurring event with no tickets: null date, null registerUrl, recurs passed", () => {
    process.env.AUTH_URL = "https://crm.example.org"
    const p = buildEventPayload({
      ...baseEvent,
      kind: "recurring",
      date: null,
      endDate: null,
      recurs: "2nd-sunday",
      recursLabel: "2nd Sun",
      startTime: "10:00 AM",
      ticketTypes: [],
    })
    expect(p.date).toBeNull()
    expect(p.recurs).toBe("2nd-sunday")
    expect(p.startTime).toBe("10:00 AM")
    expect(p.registerUrl).toBeNull()
  })
})

describe("buildEventPayload — base URL fallback", () => {
  const OLD = { auth: process.env.AUTH_URL, nextauth: process.env.NEXTAUTH_URL }
  afterEach(() => {
    process.env.AUTH_URL = OLD.auth
    process.env.NEXTAUTH_URL = OLD.nextauth
    jest.restoreAllMocks()
  })

  it("falls back to NEXTAUTH_URL when AUTH_URL is unset (prod env shape)", () => {
    delete process.env.AUTH_URL
    process.env.NEXTAUTH_URL = "https://crm.example.org/"
    const p = buildEventPayload(baseEvent)
    expect(p.registerUrl).toBe("https://crm.example.org/e/family-camp-2026")
  })

  it("warns and sets registerUrl null when neither base URL is set but tickets exist", () => {
    delete process.env.AUTH_URL
    delete process.env.NEXTAUTH_URL
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const p = buildEventPayload(baseEvent)
    expect(p.registerUrl).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe("signBody", () => {
  it("produces a deterministic HMAC-SHA256 of `${timestamp}.${body}`", () => {
    const sig = signBody("1700000000", '{"a":1}', "secret")
    const expected = createHmac("sha256", "secret").update("1700000000.{\"a\":1}").digest("hex")
    expect(sig).toBe(expected)
  })
})

describe("isAllowedSyncUrl ( SSRF guard)", () => {
  it("accepts a public https URL", () => {
    expect(isAllowedSyncUrl("https://example.org/api/crm-sync.php")).toBe(true)
  })

  it("rejects http (non-https) URLs", () => {
    expect(isAllowedSyncUrl("http://example.org/api/crm-sync.php")).toBe(false)
  })

  it("rejects unparseable URLs", () => {
    expect(isAllowedSyncUrl("not a url")).toBe(false)
  })

  it("rejects localhost", () => {
    expect(isAllowedSyncUrl("https://localhost/admin")).toBe(false)
    expect(isAllowedSyncUrl("https://foo.localhost/x")).toBe(false)
  })

  // the DNS-root trailing-dot form must not slip past the localhost or
  // IPv4-literal checks.
  it("rejects the trailing-dot (DNS-root) forms of localhost and loopback IPs", () => {
    expect(isAllowedSyncUrl("https://localhost./admin")).toBe(false)
    expect(isAllowedSyncUrl("https://foo.localhost./x")).toBe(false)
    expect(isAllowedSyncUrl("https://127.0.0.1./")).toBe(false)
    expect(isAllowedSyncUrl("https://192.168.1.1./")).toBe(false)
    expect(isAllowedSyncUrl("https://localhost../")).toBe(false)
    expect(isAllowedSyncUrl("https://127.0.0.1../")).toBe(false)
  })

  it("rejects loopback, RFC1918, link-local and metadata IPv4 literals", () => {
    expect(isAllowedSyncUrl("https://127.0.0.1/")).toBe(false)
    expect(isAllowedSyncUrl("https://10.0.0.5/")).toBe(false)
    expect(isAllowedSyncUrl("https://172.16.0.1/")).toBe(false)
    expect(isAllowedSyncUrl("https://172.31.255.255/")).toBe(false)
    expect(isAllowedSyncUrl("https://192.168.1.1/")).toBe(false)
    expect(isAllowedSyncUrl("https://169.254.169.254/")).toBe(false)
    expect(isAllowedSyncUrl("https://0.0.0.0/")).toBe(false)
  })

  it("rejects CGNAT 100.64.0.0/10 (RFC 6598) and the 198.18 benchmark range", () => {
    expect(isAllowedSyncUrl("https://100.64.0.1/")).toBe(false)
    expect(isAllowedSyncUrl("https://100.127.255.255/")).toBe(false)
    expect(isAllowedSyncUrl("https://198.18.0.1/")).toBe(false)
    expect(isAllowedSyncUrl("https://198.19.255.255/")).toBe(false)
  })

  it("accepts public IPv4 literals, 172.x outside 16-31, and 100.x outside CGNAT", () => {
    expect(isAllowedSyncUrl("https://8.8.8.8/")).toBe(true)
    expect(isAllowedSyncUrl("https://172.32.0.1/")).toBe(true)
    expect(isAllowedSyncUrl("https://100.63.0.1/")).toBe(true)
    expect(isAllowedSyncUrl("https://100.128.0.1/")).toBe(true)
    expect(isAllowedSyncUrl("https://198.20.0.1/")).toBe(true)
  })

  it("does not reject DNS names that merely start with fc/fd", () => {
    expect(isAllowedSyncUrl("https://fdcompany.com/")).toBe(true)
  })

  it("rejects non-canonical IPv4 encodings that resolve to loopback/private", () => {
    expect(isAllowedSyncUrl("https://2130706433/")).toBe(false) // integer 127.0.0.1
    expect(isAllowedSyncUrl("https://0x7f000001/")).toBe(false) // hex 127.0.0.1
    expect(isAllowedSyncUrl("https://0x7f.0.0.1/")).toBe(false) // dotted-hex
    expect(isAllowedSyncUrl("https://0177.0.0.1/")).toBe(false) // octal-octet 127.0.0.1
    expect(isAllowedSyncUrl("https://127.1/")).toBe(false) // short-dotted 127.0.0.1
    expect(isAllowedSyncUrl("https://127.0.1/")).toBe(false) // 3-part short form
    expect(isAllowedSyncUrl("https://192.168.257/")).toBe(false) // octet > 255 / short
  })

  it("rejects all IPv6 literals (no use case; mapped/abbreviated forms evade range checks)", () => {
    expect(isAllowedSyncUrl("https://[::1]/")).toBe(false)
    expect(isAllowedSyncUrl("https://[fe80::1]/")).toBe(false)
    expect(isAllowedSyncUrl("https://[fd00::1]/")).toBe(false)
    expect(isAllowedSyncUrl("https://[::ffff:127.0.0.1]/")).toBe(false) // IPv4-mapped loopback
    expect(isAllowedSyncUrl("https://[::]/")).toBe(false) // unspecified
    expect(isAllowedSyncUrl("https://[fe90::1]/")).toBe(false) // link-local beyond fe8x
    expect(isAllowedSyncUrl("https://[2001:db8::1]/")).toBe(false) // even public — DNS names only
  })
})

describe("syncEventToWebsite", () => {
  const OLD = { url: process.env.WEBSITE_SYNC_URL, secret: process.env.WEBSITE_SYNC_SECRET, auth: process.env.AUTH_URL }
  afterEach(() => {
    process.env.WEBSITE_SYNC_URL = OLD.url
    process.env.WEBSITE_SYNC_SECRET = OLD.secret
    process.env.AUTH_URL = OLD.auth
    jest.restoreAllMocks()
  })

  it("does not call fetch when sync env is unset", async () => {
    delete process.env.WEBSITE_SYNC_URL
    delete process.env.WEBSITE_SYNC_SECRET
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(baseEvent)
    const fetchSpy = jest.spyOn(global, "fetch" as never)
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    await syncEventToWebsite(42)
    expect(fetchSpy).not.toHaveBeenCalled()
    // Both unset = sync intentionally disabled — no warning needed.
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("warns (rather than silently no-op'ing) when only WEBSITE_SYNC_URL is set", async () => {
    process.env.WEBSITE_SYNC_URL = "https://example.org/api/crm-sync.php"
    delete process.env.WEBSITE_SYNC_SECRET
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(baseEvent)
    const fetchSpy = jest.spyOn(global, "fetch" as never)
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    await syncEventToWebsite(42)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it("warns (rather than silently no-op'ing) when only WEBSITE_SYNC_SECRET is set", async () => {
    delete process.env.WEBSITE_SYNC_URL
    process.env.WEBSITE_SYNC_SECRET = "shared-secret"
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(baseEvent)
    const fetchSpy = jest.spyOn(global, "fetch" as never)
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    await syncEventToWebsite(42)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it("posts a signed upsert when env is set", async () => {
    process.env.WEBSITE_SYNC_URL = "https://example.org/api/crm-sync.php"
    process.env.WEBSITE_SYNC_SECRET = "shared-secret"
    process.env.AUTH_URL = "https://crm.example.org"
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(baseEvent)
    const fetchSpy = jest.spyOn(global, "fetch" as never).mockResolvedValue({ ok: true } as never)
    await syncEventToWebsite(42)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchSpy.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }]
    expect(url).toBe("https://example.org/api/crm-sync.php")
    expect(opts.method).toBe("POST")
    expect(opts.headers["X-Sync-Signature"]).toBe(
      signBody(opts.headers["X-Sync-Timestamp"], opts.body, "shared-secret")
    )
    const parsed = JSON.parse(opts.body)
    expect(parsed.action).toBe("upsert")
    expect(parsed.event.crmId).toBe(42)
  })

  it("never calls fetch when WEBSITE_SYNC_URL is not an allowed URL", async () => {
    process.env.WEBSITE_SYNC_URL = "http://169.254.169.254/latest/meta-data"
    process.env.WEBSITE_SYNC_SECRET = "shared-secret"
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(baseEvent)
    const fetchSpy = jest.spyOn(global, "fetch" as never).mockResolvedValue({ ok: true } as never)
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    await expect(syncEventToWebsite(42)).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
  })

  it("does not throw when the website responds with an error", async () => {
    process.env.WEBSITE_SYNC_URL = "https://example.org/api/crm-sync.php"
    process.env.WEBSITE_SYNC_SECRET = "shared-secret"
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(baseEvent)
    jest.spyOn(global, "fetch" as never).mockResolvedValue({ ok: false, status: 500 } as never)
    jest.spyOn(console, "error").mockImplementation(() => {})
    await expect(syncEventToWebsite(42)).resolves.toBeUndefined()
  })

  it("does not throw when fetch itself rejects (network down, timeout)", async () => {
    process.env.WEBSITE_SYNC_URL = "https://example.org/api/crm-sync.php"
    process.env.WEBSITE_SYNC_SECRET = "shared-secret"
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(baseEvent)
    jest.spyOn(global, "fetch" as never).mockRejectedValue(new Error("ECONNREFUSED") as never)
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    await expect(syncEventToWebsite(42)).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
  })

  it("sends with a timeout signal and redirect: 'error'", async () => {
    process.env.WEBSITE_SYNC_URL = "https://example.org/api/crm-sync.php"
    process.env.WEBSITE_SYNC_SECRET = "shared-secret"
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(baseEvent)
    const fetchSpy = jest.spyOn(global, "fetch" as never).mockResolvedValue({ ok: true } as never)
    await syncEventToWebsite(42)
    const [, opts] = fetchSpy.mock.calls[0] as [string, { signal?: AbortSignal; redirect?: string }]
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(opts.redirect).toBe("error")
  })
})

describe("resyncAllEvents", () => {
  const OLD = { url: process.env.WEBSITE_SYNC_URL, secret: process.env.WEBSITE_SYNC_SECRET, auth: process.env.AUTH_URL }
  beforeEach(() => {
    process.env.WEBSITE_SYNC_URL = "https://example.org/api/crm-sync.php"
    process.env.WEBSITE_SYNC_SECRET = "shared-secret"
    process.env.AUTH_URL = "https://crm.example.org"
  })
  afterEach(() => {
    process.env.WEBSITE_SYNC_URL = OLD.url
    process.env.WEBSITE_SYNC_SECRET = OLD.secret
    process.env.AUTH_URL = OLD.auth
    jest.restoreAllMocks()
  })

  it("returns zero counts for an empty event list", async () => {
    ;(prisma.event.findMany as jest.Mock).mockResolvedValue([])
    const fetchSpy = jest.spyOn(global, "fetch" as never)
    await expect(resyncAllEvents()).resolves.toEqual({ synced: 0, failed: 0, truncated: false, disabled: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("counts every event as synced when all posts succeed", async () => {
    ;(prisma.event.findMany as jest.Mock).mockResolvedValue([baseEvent, { ...baseEvent, id: 43 }])
    jest.spyOn(global, "fetch" as never).mockResolvedValue({ ok: true } as never)
    await expect(resyncAllEvents()).resolves.toEqual({ synced: 2, failed: 0, truncated: false, disabled: false })
  })

  it("flags truncated when the event count hits the 500 cap", async () => {
    ;(prisma.event.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: 500 }, (_, i) => ({ ...baseEvent, id: i + 1 }))
    )
    jest.spyOn(console, "warn").mockImplementation(() => {})
    jest.spyOn(global, "fetch" as never).mockResolvedValue({ ok: true } as never)
    await expect(resyncAllEvents()).resolves.toEqual({ synced: 500, failed: 0, truncated: true, disabled: false })
  })

  it("continues past a failing event and reports partial failure", async () => {
    ;(prisma.event.findMany as jest.Mock).mockResolvedValue([
      baseEvent, { ...baseEvent, id: 43 }, { ...baseEvent, id: 44 },
    ])
    jest.spyOn(console, "error").mockImplementation(() => {})
    jest
      .spyOn(global, "fetch" as never)
      .mockResolvedValueOnce({ ok: true } as never)
      .mockRejectedValueOnce(new Error("ECONNRESET") as never)
      .mockResolvedValueOnce({ ok: true } as never)
    await expect(resyncAllEvents()).resolves.toEqual({ synced: 2, failed: 1, truncated: false, disabled: false })
  })
})

describe("webhook idempotency + replay token", () => {
  const OLD = { url: process.env.WEBSITE_SYNC_URL, secret: process.env.WEBSITE_SYNC_SECRET, auth: process.env.AUTH_URL }
  beforeEach(() => {
    process.env.WEBSITE_SYNC_URL = "https://example.org/api/crm-sync.php"
    process.env.WEBSITE_SYNC_SECRET = "shared-secret"
    process.env.AUTH_URL = "https://crm.example.org"
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(baseEvent)
  })
  afterEach(() => {
    process.env.WEBSITE_SYNC_URL = OLD.url
    process.env.WEBSITE_SYNC_SECRET = OLD.secret
    process.env.AUTH_URL = OLD.auth
    jest.restoreAllMocks()
  })

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

  it("carries a UUID nonce in the upsert body", async () => {
    const fetchSpy = jest.spyOn(global, "fetch" as never).mockResolvedValue({ ok: true } as never)
    await syncEventToWebsite(42)
    const [, opts] = fetchSpy.mock.calls[0] as [string, { body: string }]
    expect(JSON.parse(opts.body).nonce).toMatch(UUID)
  })

  it("carries a UUID nonce in the delete body", async () => {
    const fetchSpy = jest.spyOn(global, "fetch" as never).mockResolvedValue({ ok: true } as never)
    await syncEventDeletion(42)
    const [, opts] = fetchSpy.mock.calls[0] as [string, { body: string }]
    expect(JSON.parse(opts.body).nonce).toMatch(UUID)
  })

  it("uses a fresh nonce per request (two posts differ)", async () => {
    const fetchSpy = jest.spyOn(global, "fetch" as never).mockResolvedValue({ ok: true } as never)
    await syncEventToWebsite(42)
    await syncEventToWebsite(42)
    const a = JSON.parse((fetchSpy.mock.calls[0] as [string, { body: string }])[1].body).nonce
    const b = JSON.parse((fetchSpy.mock.calls[1] as [string, { body: string }])[1].body).nonce
    expect(a).not.toBe(b)
  })

  it("binds the nonce into the signature (tampering the body breaks the HMAC)", async () => {
    const fetchSpy = jest.spyOn(global, "fetch" as never).mockResolvedValue({ ok: true } as never)
    await syncEventToWebsite(42)
    const [, opts] = fetchSpy.mock.calls[0] as [string, { headers: Record<string, string>; body: string }]
    // Signature is over the body that includes the nonce.
    expect(opts.headers["X-Sync-Signature"]).toBe(
      signBody(opts.headers["X-Sync-Timestamp"], opts.body, "shared-secret")
    )
    // Stripping the nonce yields a different body → signature must no longer match.
    const stripped = JSON.stringify({ ...JSON.parse(opts.body), nonce: undefined })
    expect(signBody(opts.headers["X-Sync-Timestamp"], stripped, "shared-secret")).not.toBe(
      opts.headers["X-Sync-Signature"]
    )
  })
})

describe("syncEventDeletion", () => {
  const OLD = { url: process.env.WEBSITE_SYNC_URL, secret: process.env.WEBSITE_SYNC_SECRET }
  afterEach(() => {
    process.env.WEBSITE_SYNC_URL = OLD.url
    process.env.WEBSITE_SYNC_SECRET = OLD.secret
    jest.restoreAllMocks()
  })

  it("posts a signed delete action", async () => {
    process.env.WEBSITE_SYNC_URL = "https://example.org/api/crm-sync.php"
    process.env.WEBSITE_SYNC_SECRET = "shared-secret"
    const fetchSpy = jest.spyOn(global, "fetch" as never).mockResolvedValue({ ok: true } as never)
    await syncEventDeletion(42)
    const [, opts] = fetchSpy.mock.calls[0] as [string, { body: string }]
    const parsed = JSON.parse(opts.body)
    expect(parsed.action).toBe("delete")
    expect(parsed.crmId).toBe(42)
  })
})

describe("isWebsiteSyncConfigured", () => {
  const OLD = { url: process.env.WEBSITE_SYNC_URL, secret: process.env.WEBSITE_SYNC_SECRET }
  afterEach(() => {
    if (OLD.url === undefined) delete process.env.WEBSITE_SYNC_URL
    else process.env.WEBSITE_SYNC_URL = OLD.url
    if (OLD.secret === undefined) delete process.env.WEBSITE_SYNC_SECRET
    else process.env.WEBSITE_SYNC_SECRET = OLD.secret
  })

  it.each([
    [undefined, undefined, false],
    ["https://example.com/hook", undefined, false],
    [undefined, "shared-secret", false],
    ["https://example.com/hook", "shared-secret", true],
  ])("url=%s secret=%s → %s", (url, secret, expected) => {
    if (url === undefined) delete process.env.WEBSITE_SYNC_URL
    else process.env.WEBSITE_SYNC_URL = url
    if (secret === undefined) delete process.env.WEBSITE_SYNC_SECRET
    else process.env.WEBSITE_SYNC_SECRET = secret
    expect(isWebsiteSyncConfigured()).toBe(expected)
  })
})
