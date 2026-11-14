/** @jest-environment node */
import { renderSundaySchoolReportPdf } from "@/lib/pdf/SundaySchoolReportPdf"

describe("renderSundaySchoolReportPdf", () => {
  it("returns a PDF buffer, even for an empty wide table", async () => {
    const full = await renderSundaySchoolReportPdf(
      { title: "Kindy - attendance summary", headers: ["Student", "Present", "Late", "Absent", "Unmarked", "Attendance rate"], rows: [["Ann Adams", "1", "0", "0", "0", "100%"]] },
      "Example Church", "01/01/2026 to 31/12/2026",
    )
    expect(full.length).toBeGreaterThan(0)
    expect(full.subarray(0, 4).toString()).toBe("%PDF")
    const empty = await renderSundaySchoolReportPdf({ title: "T", headers: ["a", "b", "c", "d", "e", "f", "g"], rows: [] }, "Example Church", "x")
    expect(empty.subarray(0, 4).toString()).toBe("%PDF")
  })
  it("pages long tables without error", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => [`Student ${i}`, "1", "0", "0", "0", "100%"])
    const pdf = await renderSundaySchoolReportPdf({ title: "T", headers: ["Student", "P", "L", "A", "U", "R"], rows }, "Example Church", "x")
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
  })
})
