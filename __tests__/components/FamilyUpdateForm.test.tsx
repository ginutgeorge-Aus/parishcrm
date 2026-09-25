import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { FamilyUpdateForm } from "@/components/family-update/FamilyUpdateForm"
import { submitFamilyUpdate } from "@/lib/actions/familyUpdate"

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock("@/lib/actions/familyUpdate", () => ({ submitFamilyUpdate: jest.fn(async () => ({ success: "submitted" })) }))

const initial = {
  family: { address: "1 St", suburb: "", state: "", postcode: "", homePhone: "", marriageDate: "1990-02-01" },
  members: [{ personId: 5, title: "", firstName: "Jon", middleName: "", lastName: "Smith", suffix: "", gender: "", dateOfBirth: "1985-03-04", email: "", mobile: "", workPhone: "", homePhone: "" }],
}

it("renders marriage date and DOB as date inputs prefilled with ISO values", () => {
  render(<FamilyUpdateForm token="t" formToken="ft" initial={initial} churchWebsite="https://demo.example.com" />)
  const marriage = screen.getByLabelText(/marriage date/i) as HTMLInputElement
  expect(marriage.type).toBe("date")
  expect(marriage.value).toBe("1990-02-01")
  const dob = screen.getByLabelText(/date of birth/i) as HTMLInputElement
  expect(dob.type).toBe("date")
  expect(dob.value).toBe("1985-03-04")
})

it("submits marriageDate in the payload", () => {
  render(<FamilyUpdateForm token="t" formToken="ft" initial={initial} churchWebsite="https://demo.example.com" />)
  fireEvent.change(screen.getByLabelText(/marriage date/i), { target: { value: "1991-05-06" } })
  fireEvent.click(screen.getByRole("button", { name: /submit for review/i }))
  expect(submitFamilyUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ payload: expect.objectContaining({ family: expect.objectContaining({ marriageDate: "1991-05-06" }) }) }),
  )
})

it("announces a submit error via role=alert", async () => {
  ;(submitFamilyUpdate as jest.Mock).mockResolvedValueOnce({ error: "Something went wrong" })
  render(<FamilyUpdateForm token="t" formToken="ft" initial={initial} churchWebsite="https://demo.example.com" />)
  fireEvent.click(screen.getByRole("button", { name: /submit for review/i }))
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/something went wrong/i))
})

it("gives each Remove button a distinct accessible name", () => {
  const twoNew = {
    ...initial,
    members: [
      { title: "", firstName: "Amy", middleName: "", lastName: "Jones", suffix: "", gender: "", dateOfBirth: "", email: "", mobile: "", workPhone: "", homePhone: "" },
      { title: "", firstName: "Ben", middleName: "", lastName: "Jones", suffix: "", gender: "", dateOfBirth: "", email: "", mobile: "", workPhone: "", homePhone: "" },
    ],
  }
  render(<FamilyUpdateForm token="t" formToken="ft" initial={twoNew} churchWebsite="https://demo.example.com" />)
  expect(screen.getByRole("button", { name: /remove amy jones/i })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /remove ben jones/i })).toBeInTheDocument()
})

it("uses the configured church website for the opt-out link, not a hardcoded domain", () => {
  const { container } = render(
    <FamilyUpdateForm token="t" formToken="ft" initial={initial} churchWebsite="https://demo.example.com" />,
  )
  expect(container.querySelector('a[href="https://demo.example.com"]')).toBeInTheDocument()
})
