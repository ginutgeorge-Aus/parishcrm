import { render } from "@testing-library/react"
import { TurnstileWidget } from "@/components/public/TurnstileWidget"

jest.mock("@/components/NonceProvider", () => ({ useNonce: () => undefined }))

it("renders nothing when the site key is unset (test env)", () => {
  const { container } = render(<TurnstileWidget onToken={jest.fn()} />)
  expect(container).toBeEmptyDOMElement()
})
