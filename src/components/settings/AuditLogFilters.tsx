"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export function AuditLogFilters() {
  const router = useRouter()
  const sp = useSearchParams()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Controlled inputs. A same-segment soft nav (e.g. Clear) reuses this Client
  // Component instance, so defaultValue would never re-read — the inputs would
  // keep showing stale values after the URL clears. Drive them from state and
  // reset that state explicitly on Clear.
  const [actionVal, setActionVal] = useState(sp.get("action") ?? "")
  const [fromVal, setFromVal] = useState(sp.get("from") ?? "")
  const [toVal, setToVal] = useState(sp.get("to") ?? "")

  const push = useCallback(
    (key: string, value: string) => {
      // An immediate nav (date change, or the debounced action firing) supersedes any
      // still-pending debounced push — otherwise a queued action push with a stale URL
      // closure fires after and drops the just-applied date filter.
      if (timer.current) clearTimeout(timer.current)
      const params = new URLSearchParams(sp.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      params.delete("page")
      router.push(`/settings/audit-log?${params.toString()}`)
    },
    [router, sp]
  )

  // Debounce so typing an action filter doesn't fire a navigation per keystroke.
  const debouncedPush = useCallback(
    (key: string, value: string) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => push(key, value), 350)
    },
    [push]
  )

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      <Input
        placeholder="Filter by action (e.g. VIEW_PASTORAL_NOTES)"
        aria-label="Filter audit log by action"
        value={actionVal}
        className="w-72"
        onChange={(e) => {
          setActionVal(e.target.value)
          debouncedPush("action", e.target.value)
        }}
      />
      <Input
        type="date"
        aria-label="From date"
        value={fromVal}
        className="w-44"
        onChange={(e) => {
          setFromVal(e.target.value)
          push("from", e.target.value)
        }}
      />
      <Input
        type="date"
        aria-label="To date"
        value={toVal}
        className="w-44"
        onChange={(e) => {
          setToVal(e.target.value)
          push("to", e.target.value)
        }}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          if (timer.current) clearTimeout(timer.current)
          setActionVal("")
          setFromVal("")
          setToVal("")
          router.push("/settings/audit-log")
        }}
      >
        Clear
      </Button>
    </div>
  )
}
