/**
 * @jest-environment jsdom
 */
import { useEffect } from "react"
import * as React from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { UnsavedChangesProvider, useFormDirty, useUnsavedChanges, useUnsavedGuard } from "../unsavedChanges"

let probe: () => boolean = () => false
/** Exposes hasUnsaved() to the test. */
function Probe() {
  const { hasUnsaved } = useUnsavedChanges()
  useEffect(() => {
    probe = hasUnsaved
  })
  return null
}
/** A guard driven by a prop. */
function Guarded({ dirty }: { dirty: boolean }) {
  useUnsavedGuard(dirty)
  return null
}
/** A plain form using useFormDirty. */
function DirtyForm() {
  const { ref, dirty } = useFormDirty()
  return (
    <form ref={ref} onSubmit={(e) => e.preventDefault()}>
      <input aria-label="Name" name="name" defaultValue="a" />
      <button type="submit">Save</button>
      <output>{dirty ? "dirty" : "clean"}</output>
    </form>
  )
}

it("tracks registered dirty state and clears it on unmount", () => {
  const { rerender, unmount } = render(<UnsavedChangesProvider><Probe /><Guarded dirty={false} /></UnsavedChangesProvider>)
  expect(probe()).toBe(false)
  rerender(<UnsavedChangesProvider><Probe /><Guarded dirty /></UnsavedChangesProvider>)
  expect(probe()).toBe(true)
  rerender(<UnsavedChangesProvider><Probe /></UnsavedChangesProvider>)
  expect(probe()).toBe(false)
  unmount()
})

it("sets beforeunload only while dirty and removes it when clean or unmounted", () => {
  const add = jest.spyOn(window, "addEventListener")
  const remove = jest.spyOn(window, "removeEventListener")
  const { rerender, unmount } = render(<UnsavedChangesProvider><Guarded dirty={false} /></UnsavedChangesProvider>)
  expect(add).not.toHaveBeenCalledWith("beforeunload", expect.any(Function))
  rerender(<UnsavedChangesProvider><Guarded dirty /></UnsavedChangesProvider>)
  expect(add).toHaveBeenCalledWith("beforeunload", expect.any(Function))
  expect(remove).not.toHaveBeenCalledWith("beforeunload", expect.any(Function))
  rerender(<UnsavedChangesProvider><Guarded dirty={false} /></UnsavedChangesProvider>)
  expect(remove).toHaveBeenCalledWith("beforeunload", expect.any(Function))
  rerender(<UnsavedChangesProvider><Guarded dirty /></UnsavedChangesProvider>)
  remove.mockClear()
  unmount()
  expect(remove).toHaveBeenCalledWith("beforeunload", expect.any(Function))
  add.mockRestore()
  remove.mockRestore()
})

it("useFormDirty: dirty after an edit, clean when reverted or submitted", () => {
  render(<UnsavedChangesProvider><Probe /><DirtyForm /></UnsavedChangesProvider>)
  const input = screen.getByLabelText("Name")
  expect(screen.getByText("clean")).toBeInTheDocument()
  fireEvent.input(input, { target: { value: "b" } })
  expect(screen.getByText("dirty")).toBeInTheDocument()
  expect(probe()).toBe(true)
  fireEvent.input(input, { target: { value: "a" } })
  expect(screen.getByText("clean")).toBeInTheDocument()
  fireEvent.input(input, { target: { value: "c" } })
  act(() => { fireEvent.submit(input.closest("form")!) })
  expect(screen.getByText("clean")).toBeInTheDocument()
})

/** A controlled form whose "Reset" sets the value in code, then re-baselines. */
function ResettableForm() {
  const { ref, dirty, rebaseline } = useFormDirty()
  const [value, setValue] = React.useState("a")
  const [gen, setGen] = React.useState(0)
  React.useEffect(() => {
    if (gen) rebaseline()
  }, [gen, rebaseline])
  return (
    <form ref={ref}>
      <input aria-label="Name" name="name" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="button" onClick={() => { setValue("z"); setGen((g) => g + 1) }}>Reset</button>
      <output>{dirty ? "dirty" : "clean"}</output>
    </form>
  )
}

it("rebaseline: a code-set reset clears dirty and becomes the new baseline", () => {
  render(<UnsavedChangesProvider><Probe /><ResettableForm /></UnsavedChangesProvider>)
  const input = screen.getByLabelText("Name")
  fireEvent.change(input, { target: { value: "b" } })
  expect(probe()).toBe(true)
  fireEvent.click(screen.getByText("Reset"))
  expect(screen.getByText("clean")).toBeInTheDocument()
  expect(probe()).toBe(false)
  fireEvent.change(input, { target: { value: "y" } })
  fireEvent.change(input, { target: { value: "z" } })
  expect(screen.getByText("clean")).toBeInTheDocument()
})

/** A host that keeps its hook mounted while the form inside it comes and goes. */
function ConditionalForm({ show }: Readonly<{ show: boolean }>) {
  const { ref } = useFormDirty()
  return show ? (
    <form ref={ref}>
      <input aria-label="Name" name="name" defaultValue="a" />
    </form>
  ) : null
}

it("clears dirty when the form unmounts while its host stays mounted", () => {
  const { rerender } = render(<UnsavedChangesProvider><Probe /><ConditionalForm show /></UnsavedChangesProvider>)
  fireEvent.input(screen.getByLabelText("Name"), { target: { value: "b" } })
  expect(probe()).toBe(true)
  rerender(<UnsavedChangesProvider><Probe /><ConditionalForm show={false} /></UnsavedChangesProvider>)
  expect(probe()).toBe(false)
})

it("works without a provider (hasUnsaved is false)", () => {
  render(<Probe />)
  expect(probe()).toBe(false)
})
