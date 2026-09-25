"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Printer } from "lucide-react"
import { FamilyStatus } from "@/lib/generated/prisma/enums"
import { FAMILY_STATUS_LABELS } from "@/lib/familyLabels"

export function FamilyFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      router.push(`/families?${params.toString()}`)
    },
    [router, searchParams]
  )

  // Debounce the free-text inputs so we navigate once typing stops, not per
  // keystroke — same pattern as PeopleFilters.
  const urlQ = searchParams.get("q") ?? ""
  const urlSuburb = searchParams.get("suburb") ?? ""
  const [query, setQuery] = useState(urlQ)
  const [suburb, setSuburb] = useState(urlSuburb)

  // Sync local inputs when the URL changes elsewhere (Clear, back/forward).
  // Render-time adjustment — React's recommended alternative to a setState effect.
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ)
  if (urlQ !== prevUrlQ) { setPrevUrlQ(urlQ); setQuery(urlQ) }
  const [prevUrlSuburb, setPrevUrlSuburb] = useState(urlSuburb)
  if (urlSuburb !== prevUrlSuburb) { setPrevUrlSuburb(urlSuburb); setSuburb(urlSuburb) }

  useEffect(() => {
    if (query === urlQ) return
    const t = setTimeout(() => update("q", query), 300)
    return () => clearTimeout(t)
  }, [query, urlQ, update])

  useEffect(() => {
    if (suburb === urlSuburb) return
    const t = setTimeout(() => update("suburb", suburb), 300)
    return () => clearTimeout(t)
  }, [suburb, urlSuburb, update])

  const clear = () => router.push("/families")
  const hasFilters = searchParams.size > 0

  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <Input
        type="text"
        className="max-w-xs"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name…"
        aria-label="Search families by name"
      />
      <Select
        value={searchParams.get("status") ?? "ALL"}
        onValueChange={(v: string) => update("status", v === "ALL" ? "" : v)}
      >
        <SelectTrigger className="w-36" aria-label="Filter by status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All statuses</SelectItem>
          {Object.values(FamilyStatus).map((s) => (
            <SelectItem key={s} value={s}>{FAMILY_STATUS_LABELS[s]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="text"
        className="max-w-xs"
        value={suburb}
        onChange={(e) => setSuburb(e.target.value)}
        placeholder="Filter by suburb…"
        aria-label="Filter families by suburb"
      />
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clear}>
          Clear
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => window.print()} className="ml-auto">
        <Printer className="w-4 h-4 mr-1" />
        Print
      </Button>
    </div>
  )
}
