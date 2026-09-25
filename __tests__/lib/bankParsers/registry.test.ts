import { selectParser, parseWithRegistry, PARSERS } from "@/lib/bankParsers/registry"

// Minimal snippets that trigger each adapter's detect() — no full ANZ fixtures
// needed; routing is decided purely by detect(), and the parse fns themselves
// are covered by anzParser.test.ts.
const REPORT_TEXT = "Transaction Report\nAccount 123\nWithdrawals Deposits\n1 JAN 10.00"
const STATEMENT_TEXT = "ANZ Business Extra\nOpening balance\nTOTALS AT END OF PERIOD 100.00"

describe("bank parser registry", () => {
  it("registers exactly the two ANZ adapters, report first", () => {
    expect(PARSERS.map((p) => p.id)).toEqual(["anz-report", "anz-statement"])
  })

  it("routes a Transaction Report to the anz-report adapter", () => {
    expect(selectParser(REPORT_TEXT)?.id).toBe("anz-report")
  })

  it("routes a statement (has TOTALS AT END OF PERIOD) to anz-statement", () => {
    expect(selectParser(STATEMENT_TEXT)?.id).toBe("anz-statement")
  })

  it("falls back to anz-statement for unrecognized text (current behavior)", () => {
    expect(selectParser("hello world")?.id).toBe("anz-statement")
  })

  it("returns an empty errored result when no parser matches", () => {
    // Force the no-match branch with an empty parser list.
    const result = parseWithRegistry("anything", [])
    expect(result.rows).toEqual([])
    expect(result.errors).toEqual(["Unrecognized statement format"])
    expect(result.accountNumber).toBe("")
    expect(result.period).toEqual({ from: "", to: "" })
  })
})
