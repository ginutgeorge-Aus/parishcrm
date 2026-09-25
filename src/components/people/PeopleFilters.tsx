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
import { Classification, FamilyRole } from "@/lib/generated/prisma/enums"
import { CLASSIFICATION_LABELS, FAMILY_ROLE_LABELS } from "@/lib/personLabels"

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

  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <Input
        type="text"
        className="max-w-xs"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name…"
        aria-label="Search people by name"
      />
      <Select
        value={searchParams.get("classification") ?? "ALL"}
        onValueChange={(v: string) => update("classification", v === "ALL" ? "" : v)}
      >
        <SelectTrigger className="w-40" aria-label="Filter by classification">
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
        <SelectTrigger className="w-36" aria-label="Filter by role">
          <SelectValue placeholder="Role" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All roles</SelectItem>
          {Object.values(FamilyRole).map((r) => (
            <SelectItem key={r} value={r}>{FAMILY_ROLE_LABELS[r]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
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
