import { issueStateToStatus } from "@/lib/reportStatus"

describe("issueStateToStatus", () => {
  it("maps an open issue to OPEN", () => {
    expect(issueStateToStatus("open", null)).toBe("OPEN")
    expect(issueStateToStatus("open", "reopened")).toBe("OPEN")
  })

  it("maps a closed-as-completed issue to RESOLVED", () => {
    expect(issueStateToStatus("closed", "completed")).toBe("RESOLVED")
    expect(issueStateToStatus("closed", null)).toBe("RESOLVED")
  })

  it("maps a closed-as-not-planned issue to DECLINED", () => {
    expect(issueStateToStatus("closed", "not_planned")).toBe("DECLINED")
  })
})
