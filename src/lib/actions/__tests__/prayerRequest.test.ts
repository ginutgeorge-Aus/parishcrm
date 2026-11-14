/** @jest-environment node */
import { PrayerRequestSource, PrayerRequestStatus, UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = {
    prayerRequest: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    person: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  }
  m.$transaction.mockImplementation((fn: (tx: typeof m) => unknown) => fn(m))
  return { prisma: m }
})
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  safeDecrypt: jest.fn((v: string) => (v === "BROKEN" ? "[decryption error]" : v.replace(/^enc:/, ""))),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import {
  archivePrayerRequest,
  createPrayerRequest,
  getPrayerRequest,
  listPrayerRequests,
  listShareablePrayerRequests,
  setPrayerRequestStatus,
  updatePrayerRequest,
} from "@/lib/actions/prayerRequest"

const as = (role: UserRole | undefined, id = "1") =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id, role } } : null)
type M = jest.Mock
const p = prisma as unknown as {
  prayerRequest: Record<"create" | "findUnique" | "findMany" | "updateMany", M>
  person: { findUnique: M }
}
const audit = logAuditTx as M

const NON_MANAGERS = [UserRole.OFFICE_ADMIN, UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER, UserRole.TEACHER, undefined]
const STAMP = new Date("2026-11-01T00:00:00Z")

const stored = (over: Record<string, unknown> = {}) => ({
  request: "enc:Healing for my mother",
  requesterName: "enc:Sam Demo",
  requesterEmail: null,
  requesterPhone: null,
  personId: null,
  shareConsent: false,
  updatedAt: STAMP,
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  as(UserRole.PASTOR)
  p.person.findUnique.mockResolvedValue({ archivedAt: null })
  p.prayerRequest.create.mockResolvedValue({ id: 7 })
  p.prayerRequest.updateMany.mockResolvedValue({ count: 1 })
  p.prayerRequest.findUnique.mockResolvedValue(stored())
})

describe("createPrayerRequest", () => {
  const valid = { request: " Healing for my mother ", requesterName: "Sam Demo", requesterEmail: "sam@example.com" }

  it.each(NON_MANAGERS)("rejects role %s", async (role) => {
    as(role)
    expect(await createPrayerRequest(valid)).toEqual({ error: "Unauthorized" })
    expect(p.prayerRequest.create).not.toHaveBeenCalled()
  })

  it("stores a private, encrypted STAFF request and audits flags only", async () => {
    expect(await createPrayerRequest(valid)).toEqual({ id: 7 })
    expect(p.prayerRequest.create).toHaveBeenCalledWith({
      data: {
        source: PrayerRequestSource.STAFF,
        request: "enc:Healing for my mother",
        requesterName: "enc:Sam Demo",
        requesterEmail: "enc:sam@example.com",
        requesterPhone: null,
        personId: null,
        shareConsent: false,
        shareConsentAt: null,
        shareConsentById: null,
        createdById: 1,
      },
      select: { id: true },
    })
    expect(audit).toHaveBeenCalledWith(expect.anything(), 1, "PRAYER_REQUEST_CREATED", "PrayerRequest", 7, {
      personId: null,
      shareConsent: false,
    })
  })

  it("stamps consent when created as OK to share", async () => {
    await createPrayerRequest({ ...valid, shareConsent: true })
    expect(p.prayerRequest.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ shareConsent: true, shareConsentAt: expect.any(Date), shareConsentById: 1 }),
    )
  })

  it("validates text, email and linked person", async () => {
    expect(await createPrayerRequest({ request: "  " })).toEqual({ error: "Enter the prayer request" })
    expect(await createPrayerRequest({ ...valid, requesterEmail: "nope" })).toEqual({ error: "Enter a valid email" })
    p.person.findUnique.mockResolvedValue({ archivedAt: new Date() })
    expect(await createPrayerRequest({ ...valid, personId: 3 })).toEqual({ error: "Person not found" })
    expect(p.prayerRequest.create).not.toHaveBeenCalled()
  })
})

describe("updatePrayerRequest", () => {
  const upd = (over: Record<string, unknown> = {}) =>
    ({
      request: "Healing for my mother",
      requesterName: "Sam Demo",
      requesterEmail: null,
      requesterPhone: null,
      personId: null,
      shareConsent: false,
      ...over,
    }) as Parameters<typeof updatePrayerRequest>[1]

  it.each(NON_MANAGERS)("rejects role %s", async (role) => {
    as(role)
    expect(await updatePrayerRequest(7, upd({ request: "x" }))).toEqual({ error: "Unauthorized" })
    expect(p.prayerRequest.updateMany).not.toHaveBeenCalled()
  })

  it("ticking OK to share stamps consent; the write is guarded by updatedAt", async () => {
    expect(
      await updatePrayerRequest(7, upd({ shareConsent: true })),
    ).toEqual({ success: "Prayer request saved" })
    expect(p.prayerRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 7, updatedAt: STAMP },
      data: { shareConsent: true, shareConsentAt: expect.any(Date), shareConsentById: 1 },
    })
    expect(audit).toHaveBeenCalledWith(expect.anything(), 1, "PRAYER_REQUEST_UPDATED", "PrayerRequest", 7, {
      fields: [],
      shareConsent: true,
    })
  })

  it("unticking clears the consent stamp", async () => {
    p.prayerRequest.findUnique.mockResolvedValue(stored({ shareConsent: true }))
    await updatePrayerRequest(7, upd())
    expect(p.prayerRequest.updateMany.mock.calls[0][0].data).toEqual({
      shareConsent: false,
      shareConsentAt: null,
      shareConsentById: null,
    })
  })

  it("re-encrypts changed text only and clears a removed name", async () => {
    await updatePrayerRequest(7, upd({ request: "Healing for my father", requesterName: null }))
    expect(p.prayerRequest.updateMany.mock.calls[0][0].data).toEqual({
      request: "enc:Healing for my father",
      requesterName: null,
    })
  })

  it("a text edit on a shared request withdraws consent", async () => {
    p.prayerRequest.findUnique.mockResolvedValue(stored({ shareConsent: true }))
    const r = await updatePrayerRequest(7, upd({ request: "New wording", shareConsent: true }))
    expect(r).toEqual({ success: expect.stringContaining("private again") })
    expect(p.prayerRequest.updateMany.mock.calls[0][0].data).toEqual({
      request: "enc:New wording",
      shareConsent: false,
      shareConsentAt: null,
      shareConsentById: null,
    })
    expect(audit.mock.calls[0][5]).toEqual({ fields: ["request"], shareConsent: false, shareConsentVoided: true })
  })

  it("rejects a partial update (omitting a field must not clear it)", async () => {
    expect(await updatePrayerRequest(7, { request: "x" } as Parameters<typeof updatePrayerRequest>[1])).toEqual({
      error: "Missing prayer request fields",
    })
    expect(p.prayerRequest.updateMany).not.toHaveBeenCalled()
  })

  it("is a no-op when nothing changed", async () => {
    expect(await updatePrayerRequest(7, upd())).toEqual({
      success: "No changes",
    })
    expect(p.prayerRequest.updateMany).not.toHaveBeenCalled()
  })

  it("reports a concurrent edit", async () => {
    p.prayerRequest.updateMany.mockResolvedValue({ count: 0 })
    expect(await updatePrayerRequest(7, upd({ request: "Other" }))).toEqual({ error: expect.stringContaining("changed") })
    expect(audit).not.toHaveBeenCalled()
  })

  it("never overwrites unreadable text with its placeholder", async () => {
    p.prayerRequest.findUnique.mockResolvedValue(stored({ request: "BROKEN" }))
    expect(await updatePrayerRequest(7, upd({ request: "[decryption error]" }))).toEqual({
      error: expect.stringContaining("can't be read"),
    })
  })

  it("answers Not found for a missing request", async () => {
    p.prayerRequest.findUnique.mockResolvedValue(null)
    expect(await updatePrayerRequest(7, upd({ request: "x" }))).toEqual({ error: "Not found" })
    expect(await updatePrayerRequest(0, upd({ request: "x" }))).toEqual({ error: "Not found" })
  })
})

describe("setPrayerRequestStatus / archivePrayerRequest", () => {
  beforeEach(() => p.prayerRequest.findUnique.mockResolvedValue({ status: PrayerRequestStatus.ACTIVE }))

  it("archives with an audit row", async () => {
    expect(await archivePrayerRequest(7)).toEqual({ success: "Status updated" })
    expect(p.prayerRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 7, status: PrayerRequestStatus.ACTIVE },
      data: { status: PrayerRequestStatus.ARCHIVED },
    })
    expect(audit).toHaveBeenCalledWith(expect.anything(), 1, "PRAYER_REQUEST_STATUS_CHANGED", "PrayerRequest", 7, {
      from: PrayerRequestStatus.ACTIVE,
      to: PrayerRequestStatus.ARCHIVED,
    })
  })

  it.each(NON_MANAGERS)("rejects role %s", async (role) => {
    as(role)
    expect(await archivePrayerRequest(7)).toEqual({ error: "Unauthorized" })
  })

  it("rejects an unknown status and a missing row", async () => {
    expect(await setPrayerRequestStatus(7, "GONE" as PrayerRequestStatus)).toEqual({ error: "Not found" })
    p.prayerRequest.findUnique.mockResolvedValue(null)
    expect(await archivePrayerRequest(7)).toEqual({ error: "Not found" })
    expect(p.prayerRequest.updateMany).not.toHaveBeenCalled()
  })

  it("is a no-op when already in that status", async () => {
    expect(await setPrayerRequestStatus(7, PrayerRequestStatus.ACTIVE)).toEqual({ success: "No changes" })
  })
})

describe("private reads", () => {
  const viewRow = {
    id: 7,
    source: PrayerRequestSource.STAFF,
    status: PrayerRequestStatus.ACTIVE,
    request: "enc:Healing",
    requesterName: "enc:Sam Demo",
    requesterEmail: null,
    requesterPhone: null,
    personId: 3,
    shareConsent: false,
    shareConsentAt: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    person: { firstName: "Sam", lastName: "Demo" },
  }

  it.each(NON_MANAGERS)("rejects role %s", async (role) => {
    as(role)
    expect(await listPrayerRequests()).toEqual({ error: "Unauthorized" })
    expect(await getPrayerRequest(7)).toEqual({ error: "Unauthorized" })
    expect(p.prayerRequest.findMany).not.toHaveBeenCalled()
  })

  it("an empty or all-invalid status filter matches nothing", async () => {
    expect(await listPrayerRequests([])).toEqual({ requests: [] })
    expect(await listPrayerRequests(["X" as PrayerRequestStatus])).toEqual({ requests: [] })
    expect(p.prayerRequest.findMany).not.toHaveBeenCalled()
  })

  it("lists ACTIVE by default, decrypted", async () => {
    p.prayerRequest.findMany.mockResolvedValue([viewRow])
    const r = await listPrayerRequests()
    expect(p.prayerRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: [PrayerRequestStatus.ACTIVE] } }, take: 500 }),
    )
    expect(r).toEqual({ requests: [expect.objectContaining({ request: "Healing", requesterName: "Sam Demo", personName: "Sam Demo" })] })
  })

  it("gets one by id", async () => {
    p.prayerRequest.findUnique.mockResolvedValue(viewRow)
    expect(await getPrayerRequest(7)).toEqual({ request: expect.objectContaining({ id: 7, request: "Healing" }) })
    p.prayerRequest.findUnique.mockResolvedValue(null)
    expect(await getPrayerRequest(7)).toEqual({ error: "Not found" })
  })
})

describe("listShareablePrayerRequests", () => {
  it.each([UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER, UserRole.TEACHER, undefined])(
    "rejects role %s",
    async (role) => {
      as(role)
      expect(await listShareablePrayerRequests()).toEqual({ error: "Unauthorized" })
      expect(p.prayerRequest.findMany).not.toHaveBeenCalled()
    },
  )

  it("returns ACTIVE shared requests as text + date only, never contact", async () => {
    as(UserRole.OFFICE_ADMIN)
    p.prayerRequest.findMany.mockResolvedValue([
      { id: 7, request: "enc:Healing", createdAt: STAMP },
      { id: 8, request: "BROKEN", createdAt: STAMP },
    ])
    expect(await listShareablePrayerRequests()).toEqual({ requests: [{ id: 7, request: "Healing", createdAt: STAMP }] })
    expect(p.prayerRequest.findMany).toHaveBeenCalledWith({
      where: { status: PrayerRequestStatus.ACTIVE, shareConsent: true },
      select: { id: true, request: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    })
  })
})
