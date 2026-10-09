"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * True while the element's content is wider than its box, i.e. it can scroll
 * horizontally. Re-measured on resize via ResizeObserver (skipped where
 * unavailable, e.g. old browsers / jsdom, leaving it false).
 *
 * @param ref - Ref to the scroll container to observe.
 * @param enabled - When false, nothing is measured or observed.
 * @returns Whether the container currently overflows horizontally.
 */
function useHorizontalOverflow(ref: React.RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [overflows, setOverflows] = React.useState(false)
  React.useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const measure = () => setOverflows(el.scrollWidth > el.clientWidth)
    measure()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [ref, enabled])
  return overflows
}

/**
 * Table in a horizontally scrollable container; pass aria-label to make it a
 * named region that is a keyboard tab stop only while it actually overflows.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const label = props["aria-label"]
  const overflows = useHorizontalOverflow(containerRef, Boolean(label))
  return (
    // A labelled table's scroll container becomes a named region, and focusable
    // only when it overflows, so keyboard users can scroll it (axe:
    // scrollable-region-focusable) without a redundant tab stop on tables that
    // fit. Opt-in via aria-label: unlabelled tables stay plain, so pages don't
    // fill up with identically named landmarks.
    <div
      ref={containerRef}
      data-slot="table-container"
      {...(label ? { role: "region", "aria-label": label, ...(overflows && { tabIndex: 0 }) } : {})}
      className="relative w-full overflow-x-auto rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium last:[&>tr]:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground has-[[role=checkbox]]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap has-[[role=checkbox]]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
