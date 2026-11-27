"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Inline form error box (`role="alert"`). Each time a new error message
 * appears it scrolls itself to the centre of the viewport and takes focus, so
 * a phone user whose Save was rejected sees why instead of an unchanged form.
 *
 * Renders nothing when `error` is empty. Pass `children` for extra content
 * (e.g. a "Post anyway" button) shown under the message.
 *
 * @param error Message to show.
 * @param errorKey Optional token that changes per rejected submit, so an
 *   identical repeated message still re-scrolls.
 * @param className Overrides the default box styling.
 * @param children Extra content rendered inside the box.
 */
export function FormError({
  error,
  errorKey,
  className,
  children,
}: Readonly<{
  error?: string | null
  errorKey?: number
  className?: string
  children?: ReactNode
}>) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!error) return
    const el = ref.current
    if (!el) return
    el.scrollIntoView?.({ block: "center" })
    el.focus({ preventScroll: true })
  }, [error, errorKey])

  if (!error) return null
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className={cn(
        "space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive focus:outline-hidden focus-visible:ring-2 focus-visible:ring-destructive/40",
        className,
      )}
    >
      <p>{error}</p>
      {children}
    </div>
  )
}
