/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/pdf/WelcomeLetterPdf", () => ({
  renderWelcomeLetterPdf: jest.fn(() => Promise.resolve(Buffer.from("PDF"))),
}))

import { auth } from "@/auth"
import { renderWelcomeLetterPdf } from "@/lib/pdf/WelcomeLetterPdf"
import { POST } from "@/app/api/welcome-letter/preview/route"

const mockAuth = auth as jest.Mock
const mockRender = renderWelcomeLetterPdf as jest.Mock

const validModel = {
  date: "1 Jan 2026",
  addresseeName: "Jane Smith",
  addressLines: ["1 Church St"],
  greetingName: "Jane",
  memberNo: null,
  includeTransfer: false,
  transferChurch: "",
  members: ["Jane Smith"],
  bodyIntro: "Welcome",
  contributionsIntro: "",
  bodyClosing: "",
  bankAccounts: [],
  signerName: "Pastor",
  signerTitle: "Pastor",
  church: { name: "Example Church", address: "1 Church St", abn: "123", email: "a@b.com" },
}

function makeRequest(body: unknown, contentLength?: number) {
  const payload = JSON.stringify(body)
  return new Request("http://localhost/api/welcome-letter/preview", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(contentLength ?? Buffer.byteLength(payload)),
    },
    body: payload,
  })
}

beforeEach(() => jest.clearAllMocks())

describe("POST /api/welcome-letter/preview", () => {
  it("returns 403 when unauthorized", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER" } })
    const res = await POST(makeRequest(validModel))
    expect(res.status).toBe(403)
    expect(mockRender).not.toHaveBeenCalled()
  })

  it("renders a PDF for a canEdit role with a valid payload", async () => {
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_ADMIN" } })
    const res = await POST(makeRequest(validModel))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(mockRender).toHaveBeenCalled()
  })

  it("returns 413 when Content-Length exceeds the cap, before parsing the body", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
    const json = jest.fn(() => {
      throw new Error("body must not be parsed when Content-Length is over the cap")
    })
    const req = {
      headers: { get: (k: string) => (k === "content-length" ? String(200 * 1024) : null) },
      json,
    } as unknown as Request
    const res = await POST(req)
    expect(res.status).toBe(413)
    expect(json).not.toHaveBeenCalled()
    expect(mockRender).not.toHaveBeenCalled()
  })

  it("returns 413 when Content-Length is absent (chunked Transfer-Encoding bypass)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
    const json = jest.fn(() => {
      throw new Error("body must not be parsed when Content-Length is missing")
    })
    const req = {
      headers: { get: () => null },
      json,
    } as unknown as Request
    const res = await POST(req)
    expect(res.status).toBe(413)
    expect(json).not.toHaveBeenCalled()
  })

  it("returns 400 for a malformed JSON body", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
    const badBody = "{ invalid json"
    const req = new Request("http://localhost/api/welcome-letter/preview", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(badBody)) },
      body: badBody,
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 when the model fails validation", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
    const res = await POST(makeRequest({ ...validModel, date: undefined }))
    expect(res.status).toBe(400)
    expect(mockRender).not.toHaveBeenCalled()
  })
})
