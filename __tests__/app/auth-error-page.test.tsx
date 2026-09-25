/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import AuthError from "@/app/(auth)/error"

test("the page's only heading is an h1, not an h2", () => {
  render(<AuthError error={new Error("boom")} reset={() => {}} />)
  expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeInTheDocument()
})
