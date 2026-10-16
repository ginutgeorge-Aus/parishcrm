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
import { Printer, SlidersHorizontal } from "lucide-react"
import { Classification, FamilyRole } from "@/lib/generated/prisma/enums"
import { CLASSIFICATION_LABELS, FAMILY_ROLE_LABELS } from "@/lib/personLabels"
import { MINISTRY_ROLES, MINISTRY_ROLE_LABELS } from "@/lib/ministryRoles"

export function PeopleFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      router.push(`/people?${params.toString()}`)
    },
    [router, searchParams]
  )

  // Debounce the name search so we navigate once typing stops, not per keystroke.
  const urlQ = searchParams.get("q") ?? ""
  const [query, setQuery] = useState(urlQ)

  // Sync local input when the URL changes elsewhere (Clear button, back/forward).
  // Render-time adjustment — React's recommended alternative to a setState effect.
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ)
  if (urlQ !== prevUrlQ) {
    setPrevUrlQ(urlQ)
    setQuery(urlQ)
  }

  useEffect(() => {
    if (query === urlQ) return
    const t = setTimeout(() => update("q", query), 300)
    return () => clearTimeout(t)
  }, [query, urlQ, update])

  const clear = () => router.push("/people")
  const hasFilters = searchParams.size > 0
  // Select filters collapse behind a toggle on phones; always shown from md up.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const activeSelects = ["classification", "role", "ministryRole"].filter((k) => searchParams.has(k)).length

  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <Input
        type="text"
        className="flex-1 md:max-w-xs md:flex-none"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name…"
        aria-label="Search people by name"
      />
      <Button
        variant="outline"
        className="md:hidden"
        aria-expanded={filtersOpen}
        aria-controls="people-select-filters"
        onClick={() => setFiltersOpen((o) => !o)}
      >
        <SlidersHorizontal />
        Filters{activeSelects > 0 && ` (${activeSelects})`}
      </Button>
      <div
        id="people-select-filters"
        className={`${filtersOpen ? "flex" : "hidden"} w-full flex-col gap-3 md:contents`}
      >
        <Select
          value={searchParams.get("classification") ?? "ALL"}
          onValueChange={(v: string) => update("classification", v === "ALL" ? "" : v)}
        >
          <SelectTrigger className="w-full md:w-40" aria-label="Filter by classification">
            <SelectValue placeholder="Classification" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All classifications</SelectItem>
            {Object.values(Classification).map((c) => (
              <SelectItem key={c} value={c}>{CLASSIFICATION_LABELS[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={searchParams.get("role") ?? "ALL"}
          onValueChange={(v: string) => update("role", v === "ALL" ? "" : v)}
        >
          <SelectTrigger className="w-full md:w-36" aria-label="Filter by role">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All roles</SelectItem>
            {Object.values(FamilyRole).map((r) => (
              <SelectItem key={r} value={r}>{FAMILY_ROLE_LABELS[r]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={searchParams.get("ministryRole") ?? "ALL"}
          onValueChange={(v: string) => update("ministryRole", v === "ALL" ? "" : v)}
        >
          <SelectTrigger className="w-full md:w-48" aria-label="Filter by ministry role">
            <SelectValue placeholder="Ministry role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All ministry roles</SelectItem>
            {MINISTRY_ROLES.map((r) => (
              <SelectItem key={r} value={r}>{MINISTRY_ROLE_LABELS[r]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
