import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const searchSacramentPeople = jest.fn()
jest.mock("@/lib/actions/sacrament", () => ({ searchSacramentPeople: (q: string) => searchSacramentPeople(q) }))

import { SpousePicker } from "@/components/sacraments/SpousePicker"

/** A promise plus its resolve/reject handles. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const hit = (id: number, name: string) => ({ id, name, familyName: `${name} Family` })

beforeEach(() => jest.clearAllMocks())

describe("SpousePicker", () => {
  it("does not search an empty query", async () => {
    render(<SpousePicker onPick={jest.fn()} />)
    await userEvent.click(screen.getByRole("button", { name: "Search" }))
    expect(searchSacramentPeople).not.toHaveBeenCalled()
  })

  it("shows a no-match message and a failure message", async () => {
    searchSacramentPeople.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("down"))
    render(<SpousePicker onPick={jest.fn()} />)
    const box = screen.getByLabelText("Search for the spouse")
    await userEvent.type(box, "zed{enter}")
    expect(await screen.findByText("No members match.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Search" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Search failed")
  })

  it("an older search finishing last does not replace the newer results", async () => {
    const first = deferred<ReturnType<typeof hit>[]>()
    const second = deferred<ReturnType<typeof hit>[]>()
    searchSacramentPeople.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const onPick = jest.fn()
    render(<SpousePicker onPick={onPick} />)
    const box = screen.getByLabelText("Search for the spouse")
    await userEvent.type(box, "al{enter}")
    await userEvent.type(box, "ex{enter}")
    second.resolve([hit(2, "Alex New")])
    await screen.findByRole("button", { name: /Alex New/ })
    first.resolve([hit(1, "Al Old")])
    await waitFor(() => expect(screen.getByRole("button", { name: "Search" })).toBeEnabled())
    expect(screen.queryByText("Al Old")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: /Alex New/ }))
    expect(onPick).toHaveBeenCalledWith({ id: 2, name: "Alex New" })
  })

  it("an older search failing last does not clear the newer results", async () => {
    const first = deferred<ReturnType<typeof hit>[]>()
    searchSacramentPeople.mockReturnValueOnce(first.promise).mockResolvedValueOnce([hit(2, "Alex New")])
    render(<SpousePicker onPick={jest.fn()} />)
    const box = screen.getByLabelText("Search for the spouse")
    await userEvent.type(box, "al{enter}")
    await userEvent.type(box, "ex{enter}")
    await screen.findByRole("button", { name: /Alex New/ })
    first.reject(new Error("late"))
    await waitFor(() => expect(screen.getByRole("button", { name: /Alex New/ })).toBeInTheDocument())
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
