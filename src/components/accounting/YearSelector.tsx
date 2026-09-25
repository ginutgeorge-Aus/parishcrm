"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { currentFYYear } from "@/lib/fiscalYear"

type Props = {
  currentYear: number
}

export function YearSelector({ currentYear }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const fyNow = currentFYYear()
  // Range: (fyNow - 3) to (fyNow + 1) — 5 financial years
  const years = Array.from({ length: 5 }, (_, i) => fyNow - 3 + i)

  return (
    <Select
      value={String(currentYear)}
      onValueChange={(v: string) => {
        const params = new URLSearchParams(searchParams.toString())
        params.set("year", v)
        router.push(`${pathname}?${params.toString()}`)
      }}
    >
      <SelectTrigger className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map((y) => (
          <SelectItem key={y} value={String(y)}>
            {y}–{y + 1}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
