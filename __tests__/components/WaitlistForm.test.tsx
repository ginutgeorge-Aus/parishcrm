import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { WaitlistForm } from "@/components/public-event/WaitlistForm"

beforeEach(() => { global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) })

it("submits a waitlist join", async () => {
  render(<WaitlistForm slug="camp" soldOutTypes={[{ id: 7, name: "Adult" }]} allSoldOut formToken="t" />)
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Ann" } })
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } })
  fireEvent.click(screen.getByRole("button", { name: /join waitlist/i }))
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    "/api/events/camp/waitlist",
    expect.objectContaining({ method: "POST" }),
  ))
  expect(await screen.findByText(/added to the waitlist/i)).toBeInTheDocument()
})

it("clarifies the heading when only some ticket types are sold out", () => {
  render(<WaitlistForm slug="camp" soldOutTypes={[{ id: 7, name: "Adult" }]} allSoldOut={false} formToken="t" />)
  expect(screen.getByText(/some ticket types are sold out/i)).toBeInTheDocument()
})

it("announces the success replacement via role=status", async () => {
  render(<WaitlistForm slug="camp" soldOutTypes={[{ id: 7, name: "Adult" }]} allSoldOut formToken="t" />)
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Ann" } })
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } })
  fireEvent.click(screen.getByRole("button", { name: /join waitlist/i }))
  const status = await screen.findByRole("status")
  expect(status).toHaveTextContent(/added to the waitlist/i)
})
