/** @jest-environment node */
import CustomersPage from "../page"
import { auth } from "@/auth"
import { listCustomers } from "@/lib/actions/customer"
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/actions/customer", () => ({ listCustomers: jest.fn(), setCustomerActive: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("REDIRECT")
  }),
  useRouter: jest.fn(),
}))

const mockAuth = auth as jest.Mock
const mockList = listCustomers as jest.Mock
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })

describe("CustomersPage", () => {
  beforeEach(() => jest.clearAllMocks())

  it("redirects a role without accounting view access", async () => {
    as("VIEWER")
    await expect(CustomersPage()).rejects.toThrow("REDIRECT")
  })

  it("shows names only and no management controls to an AUDITOR", async () => {
    as("AUDITOR")
    mockList.mockResolvedValue([
      { id: 9, name: "Example Scouts", abn: null, email: null, phone: null, address: null, notes: null, isActive: true },
    ])
    const html = renderToStaticMarkup(await CustomersPage())
    expect(html).toContain("Example Scouts")
    expect(html).not.toContain("/accounting/customers/new")
    expect(html).not.toContain("/accounting/customers/9/edit")
  })

  it("shows contact details and management controls to an ADMIN", async () => {
    as("ADMIN")
    mockList.mockResolvedValue([
      { id: 9, name: "Example Scouts", abn: null, email: "scouts@example.com", phone: null, address: null, notes: null, isActive: true },
    ])
    const html = renderToStaticMarkup(await CustomersPage())
    expect(html).toContain("scouts@example.com")
    expect(html).toContain("/accounting/customers/new")
    expect(html).toContain("/accounting/customers/9/edit")
  })
})
