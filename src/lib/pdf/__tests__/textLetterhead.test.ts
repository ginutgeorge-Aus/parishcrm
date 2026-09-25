/** @jest-environment node */
import PDFDocument from "pdfkit"
import { drawTextLetterhead } from "@/lib/pdf/textLetterhead"

const W = 495

it("keeps the original fixed layout for a short name and address", () => {
  const doc = new PDFDocument({ size: "A4", margin: 50 })
  expect(drawTextLetterhead(doc, "Test Church", "1 Test St, Testville NSW 2000", 50, 40, W)).toBe(88)
  doc.end()
})

it("puts the rule below a long wrapped name and address", () => {
  const doc = new PDFDocument({ size: "A4", margin: 50 })
  const name = "The Very Long Named Community Church of Springfield ".repeat(4).trim().slice(0, 200)
  const address = "Unit 1, 123 Some Very Long Street Name, Suburbville ".repeat(10).trim().slice(0, 500)
  const ruleY = drawTextLetterhead(doc, name, address, 50, 40, W)
  // doc.y sits at the bottom of the last text written (the address).
  expect(ruleY).toBeGreaterThan(88)
  expect(ruleY).toBeGreaterThanOrEqual(doc.y)
  doc.end()
})

it("handles a missing address", () => {
  const doc = new PDFDocument({ size: "A4", margin: 50 })
  expect(drawTextLetterhead(doc, "Test Church", "", 50, 40, W)).toBe(88)
  doc.end()
})
