import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("@/lib/actions/publicPrayerRequest", () => ({ submitPublicPrayerRequest: jest.fn() }))

import { submitPublicPrayerRequest } from "@/lib/actions/publicPrayerRequest"
import { PublicPrayerRequestForm } from "../PublicPrayerRequestForm"

beforeEach(() => jest.clearAllMocks())

it("sends the request and shows the thank-you", async () => {
  ;(submitPublicPrayerRequest as jest.Mock).mockResolvedValue({ success: "Thank you. Your prayer request has been received." })
  render(<PublicPrayerRequestForm />)
  expect(screen.getByRole("button", { name: "Send prayer request" })).toBeDisabled()
  fireEvent.change(screen.getByLabelText("Your prayer request"), { target: { value: "Peace for our family" } })
  fireEvent.click(screen.getByRole("checkbox"))
  fireEvent.click(screen.getByRole("button", { name: "Send prayer request" }))
  await waitFor(() =>
    expect(submitPublicPrayerRequest).toHaveBeenCalledWith({
      request: "Peace for our family",
      requesterName: null,
      requesterEmail: null,
      requesterPhone: null,
      shareConsent: true,
      hp_field: "",
      openedAt: expect.any(Number),
    }),
  )
  expect(await screen.findByRole("status")).toHaveTextContent("Thank you")
})

it("shows a rate-limit error and keeps the form", async () => {
  ;(submitPublicPrayerRequest as jest.Mock).mockResolvedValue({ error: "Too many submissions. Please try again later." })
  render(<PublicPrayerRequestForm />)
  fireEvent.change(screen.getByLabelText("Your prayer request"), { target: { value: "Again" } })
  fireEvent.click(screen.getByRole("button", { name: "Send prayer request" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Too many submissions")
  expect(screen.getByLabelText("Your prayer request")).toHaveValue("Again")
})

it("has a hidden honeypot field that is sent along when filled", async () => {
  ;(submitPublicPrayerRequest as jest.Mock).mockResolvedValue({ success: "Thank you." })
  const { container } = render(<PublicPrayerRequestForm />)
  const trap = container.querySelector('input[name="hp_field"]') as HTMLInputElement
  expect(trap).toHaveAttribute("aria-hidden", "true")
  expect(trap).toHaveAttribute("tabindex", "-1")
  fireEvent.change(trap, { target: { value: "http://spam" } })
  fireEvent.change(screen.getByLabelText("Your prayer request"), { target: { value: "x" } })
  fireEvent.click(screen.getByRole("button", { name: "Send prayer request" }))
  await waitFor(() => expect(submitPublicPrayerRequest).toHaveBeenCalledWith(expect.objectContaining({ hp_field: "http://spam" })))
})
