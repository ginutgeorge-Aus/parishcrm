"use client"

import { useCallback, useRef, useState } from "react"

/**
 * Controlled open state for a Tooltip wrapped around a DropdownMenuTrigger.
 *
 * When the menu closes, Radix returns focus to the trigger, and the focus
 * reopens the tooltip (#366). This hook ignores tooltip opens during the
 * close-and-refocus step: spread `tooltip` on the Tooltip and `menuContent` on
 * the DropdownMenuContent. Hover and later keyboard focus still open it.
 */
export function useMenuTooltip() {
  const [open, setOpen] = useState(false)
  const suppress = useRef(false)

  const onOpenChange = useCallback((next: boolean) => {
    if (next && suppress.current) return
    setOpen(next)
  }, [])

  const onCloseAutoFocus = useCallback(() => {
    suppress.current = true
    setOpen(false)
    // The trigger is refocused synchronously after this handler; lift the block next tick.
    setTimeout(() => {
      suppress.current = false
    }, 0)
  }, [])

  return { tooltip: { open, onOpenChange }, menuContent: { onCloseAutoFocus } }
}
