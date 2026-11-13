/** @jest-environment node */
import { renderSundaySchoolReportPdf } from "@/lib/pdf/SundaySchoolReportPdf"
import type { ReportTable } from "@/lib/sundaySchoolReport"

/** Count PDF page objects without a PDF parser (unpdf is ESM-only under this Jest). */
const pageCount = (buf: Buffer): number => (buf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length

const table: ReportTable = {
  title: "Sunday School report: Kindy, 2026",
  subtitle: "1 child · generated 1/06/2026",
  headers: ["Child", "Present", "Attendance %", "Term 1 (/20)"],
  rows: [["Zed, Ann", 2, 75, null]],
}

it("renders a one-page landscape PDF", async () => {
  const buf = await renderSundaySchoolReportPdf(table, "Example Church")
  expect(buf.subarray(0, 5).toString()).toBe("%PDF-")
  expect(pageCount(buf)).toBe(1)
  // A4 landscape media box.
  expect(buf.toString("latin1")).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/)
})

it("paginates a long class list", async () => {
  const rows = Array.from({ length: 80 }, (_, i) => [`Child ${i}`, i, 50, 10])
  const buf = await renderSundaySchoolReportPdf({ ...table, rows }, "Example Church")
  expect(pageCount(buf)).toBeGreaterThan(1)
})

it("renders an empty report and many columns without throwing", async () => {
  const headers = ["Child", ...Array.from({ length: 30 }, (_, i) => `Exam ${i} (/100)`)]
  const buf = await renderSundaySchoolReportPdf({ ...table, headers, rows: [] }, "")
  expect(pageCount(buf)).toBe(1)
  // 30 score columns don't fit A4 at a readable width, so the page is A3 landscape.
  expect(buf.toString("latin1")).toMatch(/\/MediaBox \[0 0 1190\.55 841\.89\]/)
})
