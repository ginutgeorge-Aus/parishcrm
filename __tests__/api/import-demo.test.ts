/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn().mockResolvedValue({ user: { id: "1", role: "ADMIN" } }) }))
jest.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => jest.fn() }) }) }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/bodyLimit", () => ({ exceedsBodyLimit: jest.fn(() => false) }))
jest.mock("@/lib/logger", () => ({ logger: { warn: jest.fn(), error: jest.fn() } }))

import { NextRequest } from "next/server"
import { DEMO_ERROR } from "@/lib/demoMode"
import { POST as bankConfirm } from "@/app/api/import/bank-statement/confirm/route"
import { POST as bankPreview } from "@/app/api/import/bank-statement/route"
import { POST as familiesCommit } from "@/app/api/import/families/route"
import { POST as familiesCheck } from "@/app/api/import/families/check/route"

const big = () => new Uint8Array(300 * 1024).fill(32)
function upload(url: string, bytes: Uint8Array, name: string, type: string) {
  const form = new FormData()
  form.set("file", new File([bytes], name, { type }))
  return new NextRequest(url, { method: "POST", body: form })
}

describe("import routes in DEMO_MODE", () => {
  beforeEach(() => { process.env.DEMO_MODE = "true" })
  afterEach(() => { delete process.env.DEMO_MODE })

  it("blocks bank-statement confirm", async () => {
    const res = await bankConfirm(new NextRequest("http://localhost/api/import/bank-statement/confirm", { method: "POST", body: "{}" }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: DEMO_ERROR })
  })

  it("blocks families commit", async () => {
    const res = await familiesCommit(upload("http://localhost/api/import/families", new Uint8Array(10), "f.csv", "text/csv"))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: DEMO_ERROR })
  })

  it("caps bank-statement preview at 200 KB", async () => {
    const pdf = big(); pdf.set(new TextEncoder().encode("%PDF-1.4"), 0)
    const res = await bankPreview(upload("http://localhost/api/import/bank-statement", pdf, "s.pdf", "application/pdf"))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: "Demo imports are limited to 200 KB" })
  })

  it("caps families check at 200 KB", async () => {
    const res = await familiesCheck(upload("http://localhost/api/import/families/check", big(), "f.csv", "text/csv"))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: "Demo imports are limited to 200 KB" })
  })
})
