/** @jest-environment node */

// create/edit routes had inconsistent or absent breadcrumbs. Verifies
// the linked-breadcrumb pattern now standardized across these routes points
// at the right list/detail hrefs (including the dynamic id segments).

import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: { findMany: jest.fn(), findUnique: jest.fn() },
    person: { findUnique: jest.fn() },
    event: { findUnique: jest.fn() },
    familyUpdateSubmission: { findUnique: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v),
}))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))
jest.mock("@/lib/membershipSettings", () => ({ getMembershipSettings: jest.fn().mockResolvedValue({ parishFields: false, minDues: null }) }))
jest.mock("@/components/families/FamilyForm", () => ({ FamilyForm: () => null }))
jest.mock("@/components/people/PersonForm", () => ({ PersonForm: () => null }))
jest.mock("@/components/events/EventForm", () => ({ EventForm: () => null }))
jest.mock("@/components/events/PublishToggle", () => ({ PublishToggle: () => null }))
jest.mock("@/components/events/DeleteEventButton", () => ({ DeleteEventButton: () => null }))
jest.mock("@/components/family-update/SubmissionReview", () => ({ SubmissionReview: () => null }))
jest.mock("@/lib/familyUpdateDiff", () => ({ diffFamilyUpdate: jest.fn(() => ({ family: [], members: [] })) }))
jest.mock("@/lib/familyUpdatePayload", () => ({
  FamilyUpdatePayloadSchema: { safeParse: jest.fn(() => ({ success: true, data: { family: {}, members: [] } })) },
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const mockAuth = auth as jest.Mock
const ADMIN_SESSION = { user: { role: "ADMIN", id: "1" } }

beforeEach(() => jest.clearAllMocks())

describe("breadcrumb consistency", () => {
  it("families/new links back to /families", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    const NewFamilyPage = (await import("@/app/(dashboard)/families/new/page")).default
    const html = renderToStaticMarkup(await NewFamilyPage())
    expect(html).toContain('href="/families"')
  })

  it("people/new links back to /people", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    ;(prisma.family.findMany as jest.Mock).mockResolvedValue([])
    const NewPersonPage = (await import("@/app/(dashboard)/people/new/page")).default
    const html = renderToStaticMarkup(await NewPersonPage())
    expect(html).toContain('href="/people"')
  })

  it("families/[id]/people/new links to /families and the specific family", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 42, name: "Smith Family" })
    const NewPersonInFamilyPage = (await import("@/app/(dashboard)/families/[id]/people/new/page")).default
    const html = renderToStaticMarkup(await NewPersonInFamilyPage({ params: Promise.resolve({ id: "42" }) }))
    expect(html).toContain('href="/families"')
    expect(html).toContain('href="/families/42"')
  })

  it("people/[id]/edit links to /families and the person's own detail page", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({
      id: 7, familyId: 1, firstName: "Jane", lastName: "Doe", archivedAt: null,
    })
    const EditPersonPage = (await import("@/app/(dashboard)/people/[id]/edit/page")).default
    const html = renderToStaticMarkup(await EditPersonPage({ params: Promise.resolve({ id: "7" }) }))
    expect(html).toContain('href="/families"')
    expect(html).toContain('href="/people/7"')
  })

  it("families/[id]/edit links to /families and the family's own detail page", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 5, name: "Smith Family" })
    const EditFamilyPage = (await import("@/app/(dashboard)/families/[id]/edit/page")).default
    const html = renderToStaticMarkup(await EditFamilyPage({ params: Promise.resolve({ id: "5" }) }))
    expect(html).toContain('href="/families"')
    expect(html).toContain('href="/families/5"')
  })

  it("families/updates/[id] links to the inbox and the submitting family", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue({
      id: 9,
      status: "PENDING",
      payload: { family: {}, members: [] },
      family: { id: 3, name: "Smith Family", people: [] },
    })
    const SubmissionDetail = (await import("@/app/(dashboard)/families/updates/[id]/page")).default
    const html = renderToStaticMarkup(await SubmissionDetail({ params: Promise.resolve({ id: "9" }) }))
    expect(html).toContain('href="/families/updates"')
    expect(html).toContain('href="/families/3"')
  })

  it("events/new links back to /events", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    const NewEventPage = (await import("@/app/(dashboard)/events/new/page")).default
    const html = renderToStaticMarkup(await NewEventPage())
    expect(html).toContain('href="/events"')
  })

  it("events/[id]/edit links back to /events", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
      id: 11, title: "Fete", slug: "fete", ticketTypes: [], images: [],
    })
    const EditEventPage = (await import("@/app/(dashboard)/events/[id]/edit/page")).default
    const html = renderToStaticMarkup(await EditEventPage({ params: Promise.resolve({ id: "11" }) }))
    expect(html).toContain('href="/events"')
  })
})

describe("dashboard [id] pages notFound on non-numeric id", () => {
  it("families/[id]/people/new", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    const NewPersonInFamilyPage = (await import("@/app/(dashboard)/families/[id]/people/new/page")).default
    await expect(
      NewPersonInFamilyPage({ params: Promise.resolve({ id: "abc" }) })
    ).rejects.toThrow("NOT_FOUND")
    expect(prisma.family.findUnique).not.toHaveBeenCalled()
  })

  it("people/[id]/edit", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    const EditPersonPage = (await import("@/app/(dashboard)/people/[id]/edit/page")).default
    await expect(
      EditPersonPage({ params: Promise.resolve({ id: "abc" }) })
    ).rejects.toThrow("NOT_FOUND")
    expect(prisma.person.findUnique).not.toHaveBeenCalled()
  })

  it("families/[id]/edit", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    const EditFamilyPage = (await import("@/app/(dashboard)/families/[id]/edit/page")).default
    await expect(
      EditFamilyPage({ params: Promise.resolve({ id: "abc" }) })
    ).rejects.toThrow("NOT_FOUND")
    expect(prisma.family.findUnique).not.toHaveBeenCalled()
  })

  it("events/[id]/edit", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    const EditEventPage = (await import("@/app/(dashboard)/events/[id]/edit/page")).default
    await expect(
      EditEventPage({ params: Promise.resolve({ id: "abc" }) })
    ).rejects.toThrow("NOT_FOUND")
    expect(prisma.event.findUnique).not.toHaveBeenCalled()
  })
})
