import { act, renderHook } from "@testing-library/react"
import { useMenuTooltip } from "../useMenuTooltip"

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

it("ignores the tooltip open caused by focus returning after the menu closes (#366)", () => {
  const { result } = renderHook(() => useMenuTooltip())
  act(() => result.current.tooltip.onOpenChange(true))
  expect(result.current.tooltip.open).toBe(true)

  act(() => {
    result.current.menuContent.onCloseAutoFocus()
    result.current.tooltip.onOpenChange(true) // focus returns to the trigger
  })
  expect(result.current.tooltip.open).toBe(false)

  act(() => jest.runAllTimers())
  act(() => result.current.tooltip.onOpenChange(true)) // later hover/focus
  expect(result.current.tooltip.open).toBe(true)
})
