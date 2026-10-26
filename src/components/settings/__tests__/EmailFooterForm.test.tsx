/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react"
import { EmailFooterForm } from "../EmailFooterForm"
import { upsertSetting } from "@/lib/actions/settings"

jest.mock("@/lib/actions/settings", () => ({ upsertSetting: jest.fn() }))

describe("EmailFooterForm", () => {
  it("pre-fills the stored footer and posts the emailFooter key", async () => {
    ;(upsertSetting as jest.Mock).mockResolvedValueOnce({ success: true })
    render(<EmailFooterForm footer="Sent via {churchName}" />)
    const textarea = screen.getByLabelText("Footer text")
    expect(textarea).toHaveValue("Sent via {churchName}")
    expect(textarea).toHaveAccessibleDescription(/Leave blank to turn the footer off/)

    fireEvent.change(textarea, { target: { value: "" } })
    fireEvent.submit(textarea.closest("form")!)
    await screen.findByRole("button", { name: "Save" })
    const fd = (upsertSetting as jest.Mock).mock.calls[0][1] as FormData
    expect(fd.get("key")).toBe("emailFooter")
    expect(fd.get("value")).toBe("")
  })

  it("links the save error to the textarea", async () => {
    ;(upsertSetting as jest.Mock).mockResolvedValueOnce({ error: "Footer must be 500 characters or fewer" })
    render(<EmailFooterForm footer="x" />)
    const textarea = screen.getByLabelText("Footer text")
    fireEvent.submit(textarea.closest("form")!)
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Footer must be 500 characters or fewer")
    expect(textarea).toHaveAccessibleDescription(/Footer must be 500 characters or fewer/)
  })
})
