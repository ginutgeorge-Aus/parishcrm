/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: { eventImage: { findFirst: jest.fn() } },
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(() => true),
}))

import { NextRequest } from "next/server"
import { GET } from "@/app/api/events/[slug]/image/[kind]/route"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { rateLimit } from "@/lib/rateLimit"

const findFirst = prisma.eventImage.findFirst as jest.Mock
const mockAuth = auth as jest.Mock
const mockRateLimit = rateLimit as jest.Mock
const req = () => new NextRequest("http://localhost/api/events/gala/image/banner", { headers: { "x-forwarded-for": "1.1.1.1" } })
const call = (slug: string, kind: string) =>
  GET(req(), { params: Promise.resolve({ slug, kind }) })

beforeEach(() => jest.clearAllMocks())

it("404s on an unknown kind", async () => {
  const res = await call("gala", "logo")
  expect(res.status).toBe(404)
  expect(findFirst).not.toHaveBeenCalled()
})

it("404s on a prototype-polluting kind without touching the DB", async () => {
  for (const kind of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    const res = await call("gala", kind)
    expect(res.status).toBe(404)
  }
  expect(findFirst).not.toHaveBeenCalled()
})

it("serves a published event image with its content-type", async () => {
  findFirst.mockResolvedValue({
    data: Buffer.from("PNGDATA"), mimeType: "image/png",
    event: { isPublished: true },
  })
  const res = await call("gala", "poster")
  expect(res.status).toBe(200)
  expect(res.headers.get("Content-Type")).toBe("image/png")
  expect(await res.text()).toBe("PNGDATA")
})

it("404s a draft event image for an anonymous request", async () => {
  findFirst.mockResolvedValue({
    data: Buffer.from("x"), mimeType: "image/png",
    event: { isPublished: false },
  })
  mockAuth.mockResolvedValue(null)
  const res = await call("draft", "banner")
  expect(res.status).toBe(404)
})

it("serves a draft event image to an editor", async () => {
  findFirst.mockResolvedValue({
    data: Buffer.from("y"), mimeType: "image/jpeg",
    event: { isPublished: false },
  })
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  const res = await call("draft", "banner")
  expect(res.status).toBe(200)
})

it("404s when no image row exists", async () => {
  findFirst.mockResolvedValue(null)
  const res = await call("gala", "banner")
  expect(res.status).toBe(404)
})

it("429s when the per-IP rate limit is exceeded, before touching the DB", async () => {
  mockRateLimit.mockReturnValueOnce(false)
  const res = await call("gala", "banner")
  expect(res.status).toBe(429)
  expect(findFirst).not.toHaveBeenCalled()
})
