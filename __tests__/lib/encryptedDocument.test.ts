/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/crypto", () => ({ decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))

import { encryptedDocumentResponse } from "@/lib/encryptedDocument"

const blob = (plain: string) => new Uint8Array(Buffer.from(`enc:${Buffer.from(plain).toString("base64")}`, "utf8"))

it("decodes the blob and serves a safe type inline with hardening headers", async () => {
  const res = encryptedDocumentResponse({ blob: blob("pdf-bytes"), encryptedName: "enc:a b.pdf", contentType: "application/pdf", fallbackName: "x" })
  expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("pdf-bytes")
  expect(res.headers.get("Content-Type")).toBe("application/pdf")
  expect(res.headers.get("Content-Disposition")).toBe(`inline; filename="a b.pdf"; filename*=UTF-8''a%20b.pdf`)
  expect(res.headers.get("Cache-Control")).toBe("private, no-store")
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
})

it("forces an unsafe type to an octet-stream download", () => {
  const res = encryptedDocumentResponse({ blob: blob("x"), encryptedName: "enc:e.html", contentType: "text/html", fallbackName: "x" })
  expect(res.headers.get("Content-Type")).toBe("application/octet-stream")
  expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/)
})

it("uses the fallback name and ASCII-safe fallback param", () => {
  const none = encryptedDocumentResponse({ blob: blob("x"), encryptedName: null, contentType: "image/png", fallbackName: "clearance" })
  expect(none.headers.get("Content-Disposition")).toContain(`filename="clearance"`)
  const odd = encryptedDocumentResponse({ blob: blob("x"), encryptedName: 'enc:é"q.png', contentType: "image/png", fallbackName: "x" })
  expect(odd.headers.get("Content-Disposition")).toContain(`filename="__q.png"`)
})
