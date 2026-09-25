"use client"

import { useRouter } from "next/navigation"
import { useActionState, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { cn } from "@/lib/utils"
import { sydneyTodayYMD } from "@/lib/dates"
import type { ActionResult } from "@/lib/actions/types"
import { APP_CURRENCY } from "@/lib/appConfig"

type Person = { id: number; firstName: string; lastName: string }

export function SessionForm({
  action,
  people,
}: {
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  people: Person[]
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(action, undefined)
  const [custodianId, setCustodianId] = useState("")
  const [custodianOpen, setCustodianOpen] = useState(false)
  const [custodianError, setCustodianError] = useState(false)

  const selectedCustodian = people.find((p) => String(p.id) === custodianId)

  return (
    <form
      action={formAction}
      className="max-w-lg space-y-4"
      onSubmit={(e) => {
        // Custodian rides in a hidden input (no native required), so guard it
        // client-side to avoid a server round-trip with a generic error.
        if (!custodianId) { e.preventDefault(); setCustodianError(true) }
      }}
    >
      {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}

      {/* Hidden input so custodianId is submitted with form */}
      <input type="hidden" name="custodianId" value={custodianId} />

      <div className="space-y-1">
        <Label htmlFor="sessionDate">Session date</Label>
        <Input
          id="sessionDate"
          name="sessionDate"
          type="date"
          required
          defaultValue={sydneyTodayYMD()}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="custodian">Custodian</Label>
        <Popover open={custodianOpen} onOpenChange={setCustodianOpen}>
          <PopoverTrigger asChild>
            <Button
              id="custodian"
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={custodianOpen}
              className="w-full justify-between font-normal"
            >
              {selectedCustodian
                ? `${selectedCustodian.firstName} ${selectedCustodian.lastName}`
                : "Search custodian…"}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0" align="start">
            <Command>
              <CommandInput placeholder="Type a name…" />
              <CommandList>
                <CommandEmpty>No person found.</CommandEmpty>
                <CommandGroup>
                  {people.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${p.firstName} ${p.lastName}`}
                      onSelect={() => { setCustodianId(String(p.id)); setCustodianError(false); setCustodianOpen(false) }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", custodianId === String(p.id) ? "opacity-100" : "opacity-0")} />
                      {p.firstName} {p.lastName}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {custodianError && (
          <p role="alert" className="text-sm text-destructive">Select a custodian.</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="openingBalance">
          Opening balance ({APP_CURRENCY}){" "}
          <span className="text-muted-foreground text-xs">(0 for new sessions)</span>
        </Label>
        <Input
          id="openingBalance"
          name="openingBalance"
          type="number"
          step="0.01"
          min="0"
          defaultValue="0.00"
          placeholder="0.00"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>{isPending ? "Opening…" : "Open session"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
