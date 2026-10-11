/** @jest-environment node */
import { GET } from "../route"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { loadInvoicePdf } from "@/lib/invoicePdfModel"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/invoicePdfModel", () => ({ loadInvoicePdf: jest.fn() }))

const mockAuth = auth as jest.Mock
const call = (id: string) => GET({} as never, { params: Promise.resolve({ id }) })
beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(loadInvoicePdf as jest.Mock).mockResolvedValue({ pdf: Buffer.from("%PDF-fake"), filename: "INV-0001.pdf", invoiceNo: "INV-0001" })
})

describe("GET invoice pdf", () => {
  it("401 unauthenticated", async () => { mockAuth.mockResolvedValue(null); expect((await call("5")).status).toBe(401) })
  it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER"])("403 for %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { id: "1", role } }); expect((await call("5")).status).toBe(403)
  })
  it("400 bad id", async () => expect((await call("abc")).status).toBe(400))
  it("404 missing", async () => { (loadInvoicePdf as jest.Mock).mockResolvedValue(null); expect((await call("5")).status).toBe(404) })
  it("downloads as attachment and audits", async () => {
    const res = await call("5")
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="INV-0001.pdf"')
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_PDF_DOWNLOADED", "Invoice", 5, { invoiceNo: "INV-0001" })
  })
  it("allows OFFICE_ADMIN", async () => { mockAuth.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } }); expect((await call("5")).status).toBe(200) })
})
