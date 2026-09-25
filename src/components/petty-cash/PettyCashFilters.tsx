"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Person = { id: number; firstName: string; lastName: string }

export function PettyCashFilters({ people }: { people: Person[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [custodianOpen, setCustodianOpen] = useState(false)

  const selectedCustodianId = searchParams.get("custodian") ?? ""
  const selectedCustodian = people.find((p) => String(p.id) === selectedCustodianId)

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      router.push(`/accounting/petty-cash?${params.toString()}`)
    },
    [router, searchParams]
  )

  const clear = () => router.push("/accounting/petty-cash")
  const hasFilters = searchParams.size > 0

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        type="date"
        className="w-40"
        value={searchParams.get("from") ?? ""}
        onChange={(e) => update("from", e.target.value)}
        aria-label="From date"
      />
      <Input
        type="date"
        className="w-40"
        value={searchParams.get("to") ?? ""}
        onChange={(e) => update("to", e.target.value)}
        aria-label="To date"
      />
      <Select
        value={searchParams.get("status") ?? ""}
        onValueChange={(v: string) => update("status", v === "ALL" ? "" : v)}
      >
        <SelectTrigger className="w-36">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All statuses</SelectItem>
          <SelectItem value="OPEN">Open</SelectItem>
          <SelectItem value="CLOSED">Closed</SelectItem>
        </SelectContent>
      </Select>
      <Popover open={custodianOpen} onOpenChange={setCustodianOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={custodianOpen}
            className="w-44 justify-between font-normal"
          >
            <span className="truncate">
              {selectedCustodian
                ? `${selectedCustodian.firstName} ${selectedCustodian.lastName}`
                : "All custodians"}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-0" align="start">
          <Command>
            <CommandInput placeholder="Type a name…" />
            <CommandList>
              <CommandEmpty>No person found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="All custodians"
                  onSelect={() => { update("custodian", ""); setCustodianOpen(false) }}
                >
                  <Check className={cn("mr-2 h-4 w-4", selectedCustodianId === "" ? "opacity-100" : "opacity-0")} />
                  All custodians
                </CommandItem>
                {people.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`${p.firstName} ${p.lastName}`}
                    onSelect={() => { update("custodian", String(p.id)); setCustodianOpen(false) }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", selectedCustodianId === String(p.id) ? "opacity-100" : "opacity-0")} />
                    {p.firstName} {p.lastName}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clear}>
          Clear
        </Button>
      )}
    </div>
  )
}
