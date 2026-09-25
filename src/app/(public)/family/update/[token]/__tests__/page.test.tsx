/** @jest-environment node */
import FamilyUpdatePage from "../page"
import { prisma } from "@/lib/prisma"
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/lib/prisma", () => ({
  prisma: { familyUpdateInvite: { findUnique: jest.fn() } },
}))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/familyUpdateToken", () => ({
  hashInviteToken: jest.fn((t: string) => `hash:${t}`),
}))
jest.mock("@/lib/formToken", () => ({
  issueFormToken: jest.fn(() => "form-token"),
}))
// getChurchSettings uses unstable_cache, which throws "incrementalCache missing"
// outside a Next request context — mock it so the page renders under jest.
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn().mockResolvedValue({
    name: "Demo Church", address: "", abn: "", email: "", website: "https://demo.example.com",
  }),
}))

const mockFormComponent = jest.fn((_props: unknown) => null)
jest.mock("@/components/family-update/FamilyUpdateForm", () => ({
  FamilyUpdateForm: (props: unknown) => mockFormComponent(props),
}))

const mockFindUnique = prisma.familyUpdateInvite.findUnique as jest.Mock

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el)
}

const params = (token: string) => Promise.resolve({ token })

beforeEach(() => jest.clearAllMocks())

describe("FamilyUpdatePage — invalid/expired invite", () => {
  it("shows Link expired when no invite matches the token", async () => {
    mockFindUnique.mockResolvedValue(null)
    const html = render(await FamilyUpdatePage({ params: params("abc") }))
    expect(html).toContain("Link expired")
    expect(mockFormComponent).not.toHaveBeenCalled()
  })

  it("shows Link expired for a REVOKED invite", async () => {
    mockFindUnique.mockResolvedValue({
      status: "REVOKED",
      expiresAt: new Date(Date.now() + 86_400_000),
      family: { people: [] },
    })
    const html = render(await FamilyUpdatePage({ params: params("abc") }))
    expect(html).toContain("Link expired")
    expect(mockFormComponent).not.toHaveBeenCalled()
  })

  it("shows Link expired for a past expiresAt", async () => {
    mockFindUnique.mockResolvedValue({
      status: "SENT",
      expiresAt: new Date(Date.now() - 1000),
      family: { people: [] },
    })
    const html = render(await FamilyUpdatePage({ params: params("abc") }))
    expect(html).toContain("Link expired")
    expect(mockFormComponent).not.toHaveBeenCalled()
  })

  it("shows Link expired for a still-SENT invite whose family was archived after send", async () => {
    mockFindUnique.mockResolvedValue({
      status: "SENT",
      expiresAt: new Date(Date.now() + 86_400_000),
      family: { archivedAt: new Date(), name: "Archived Family", people: [] },
    })
    const html = render(await FamilyUpdatePage({ params: params("abc") }))
    expect(html).toContain("Link expired")
    expect(html).not.toContain("Archived Family")
    expect(mockFormComponent).not.toHaveBeenCalled()
  })
})

describe("FamilyUpdatePage — already submitted", () => {
  it("shows a thank-you notice for a SUBMITTED invite", async () => {
    mockFindUnique.mockResolvedValue({
      status: "SUBMITTED",
      expiresAt: new Date(Date.now() + 86_400_000),
      family: { people: [] },
    })
    const html = render(await FamilyUpdatePage({ params: params("abc") }))
    expect(html).toContain("Thank you")
    expect(mockFormComponent).not.toHaveBeenCalled()
  })
})

describe("FamilyUpdatePage — valid SENT invite", () => {
  it("passes correctly-decrypted family/member props to FamilyUpdateForm", async () => {
    mockFindUnique.mockResolvedValue({
      status: "SENT",
      expiresAt: new Date(Date.now() + 86_400_000),
      family: {
        name: "Miller Family",
        address: "enc:1 Example St",
        suburb: "enc:Sampletown",
        state: "enc:NSW",
        postcode: "enc:2000",
        homePhone: "enc:0249001234",
        marriageDate: new Date("2005-06-07"),
        people: [
          {
            id: 11,
            title: "Mr",
            firstName: "John",
            middleName: "",
            lastName: "Miller",
            suffix: "",
            gender: "MALE",
            dateOfBirth: "enc:1980-01-02",
            email: "enc:john@example.com",
            mobile: "enc:0400111222",
            workPhone: null,
            homePhone: null,
          },
        ],
      },
    })

    const html = render(await FamilyUpdatePage({ params: params("tok123") }))

    expect(html).toContain("Miller Family")
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: "hash:tok123" } })
    )
    expect(mockFormComponent).toHaveBeenCalledTimes(1)
    const props = mockFormComponent.mock.calls[0][0] as {
      token: string
      formToken: string
      initial: { family: Record<string, string>; members: Array<Record<string, unknown>> }
    }
    expect(props.token).toBe("tok123")
    expect(props.formToken).toBe("form-token")
    expect(props.initial.family).toEqual({
      address: "1 Example St",
      suburb: "Sampletown",
      state: "NSW",
      postcode: "2000",
      homePhone: "0249001234",
      marriageDate: "2005-06-07",
    })
    expect(props.initial.members).toEqual([
      {
        personId: 11,
        title: "Mr",
        firstName: "John",
        middleName: "",
        lastName: "Miller",
        suffix: "",
        gender: "MALE",
        dateOfBirth: "1980-01-02",
        email: "john@example.com",
        mobile: "0400111222",
        workPhone: "",
        homePhone: "",
      },
    ])
  })
})
