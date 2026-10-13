/** @jest-environment node */
import NewCustomerPage from "../new/page"
import EditCustomerPage from "../[id]/edit/page"
import { auth } from "@/auth"
import { getCustomerForEdit } from "@/lib/actions/customer"
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/actions/customer", () => ({ getCustomerForEdit: jest.fn() }))
jest.mock("@/components/accounting/CustomerForm", () => ({ __esModule: true, default: (p: { edit?: { id: number } }) => `FORM:${p.edit?.id ?? "new"}` }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))

const mockAuth = auth as jest.Mock
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe("customer form pages", () => {
  beforeEach(() => jest.clearAllMocks())
  it("new: gates and renders", async () => {
    as("AUDITOR")
    await expect(NewCustomerPage()).rejects.toThrow("REDIRECT:/accounting/customers")
    as("ADMIN")
    expect(renderToStaticMarkup(await NewCustomerPage())).toContain("FORM:new")
  })
  it("edit: gates, 404s and renders", async () => {
    as("OFFICE_ADMIN")
    await expect(EditCustomerPage(params("9"))).rejects.toThrow("REDIRECT:/accounting/customers")
    as("ADMIN")
    await expect(EditCustomerPage(params("x"))).rejects.toThrow("NOT_FOUND")
    ;(getCustomerForEdit as jest.Mock).mockResolvedValue(null)
    await expect(EditCustomerPage(params("9"))).rejects.toThrow("NOT_FOUND")
    ;(getCustomerForEdit as jest.Mock).mockResolvedValue({ id: 9, name: "Example Scouts" })
    expect(renderToStaticMarkup(await EditCustomerPage(params("9")))).toContain("FORM:9")
  })
})
