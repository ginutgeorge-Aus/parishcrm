"use client"

import { useActionState, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { updatePettyCashCustodian } from "@/lib/actions/settings"
import { FormFeedback } from "@/components/ui/FormFeedback"

type Person = { id: number; firstName: string; lastName: string }

export function PettyCashCustodianForm({ people, currentId }: { people: Person[]; currentId: number | null }) {
  const [state, formAction, isPending] = useActionState(updatePettyCashCustodian, undefined)
  const [custodianId, setCustodianId] = useState(currentId ? String(currentId) : "")
  const [open, setOpen] = useState(false)
  const selected = people.find((p) => String(p.id) === custodianId)

  return (
    <form action={formAction} className="space-y-3">
      <FormFeedback state={state} />

      <input type="hidden" name="custodianId" value={custodianId} />

      <div className="space-y-1">
        <Label htmlFor="pettyCustodian">Default petty cash custodian</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button id="pettyCustodian" type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
              {selected ? `${selected.firstName} ${selected.lastName}` : "None (auto-open disabled)"}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0" align="start">
            <Command>
              <CommandInput placeholder="Type a name…" />
              <CommandList>
                <CommandEmpty>No person found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="__none__" onSelect={() => { setCustodianId(""); setOpen(false) }}>
                    <Check className={cn("mr-2 h-4 w-4", custodianId === "" ? "opacity-100" : "opacity-0")} />
                    None (disable auto-open)
                  </CommandItem>
                  {people.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${p.firstName} ${p.lastName} ${p.id}`}
                      onSelect={() => { setCustodianId(String(p.id)); setOpen(false) }}
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
      </div>

      <Button type="submit" size="sm" disabled={isPending}>{isPending ? "Saving…" : "Save custodian"}</Button>
    </form>
  )
}
