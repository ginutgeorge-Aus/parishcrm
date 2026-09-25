"use client"

import { useActionState, useState } from "react"
import { Check, ChevronsUpDown, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { updateSessionCustodian } from "@/lib/actions/pettyCashSession"
import { FormFeedback } from "@/components/ui/FormFeedback"

type Person = { id: number; firstName: string; lastName: string }

export function SessionCustodianEditor({
  sessionId,
  people,
  currentId,
  currentName,
}: {
  sessionId: number
  people: Person[]
  currentId: number
  currentName: string
}) {
  const [editing, setEditing] = useState(false)
  const [custodianId, setCustodianId] = useState(String(currentId))
  const [open, setOpen] = useState(false)
  // Close the editor once the server confirms the save (runs inside the action
  // transition, not an effect) — revalidation refreshes the displayed name.
  const [state, formAction, isPending] = useActionState(
    async (prev: Awaited<ReturnType<typeof updateSessionCustodian>>, formData: FormData) => {
      const result = await updateSessionCustodian(sessionId, prev, formData)
      if (result && "success" in result) setEditing(false)
      return result
    },
    undefined
  )
  const selected = people.find((p) => String(p.id) === custodianId)

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        Custodian: {currentName}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-0.5 text-primary hover:underline"
        >
          <Pencil className="h-3 w-3" /> Change
        </button>
      </span>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="custodianId" value={custodianId} />
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              role="combobox"
              aria-expanded={open}
              className="justify-between font-normal"
            >
              {selected ? `${selected.firstName} ${selected.lastName}` : "Select custodian…"}
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
        <Button type="submit" size="sm" disabled={isPending}>{isPending ? "Saving…" : "Save"}</Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => { setEditing(false); setCustodianId(String(currentId)) }}
        >
          Cancel
        </Button>
      </div>
      <FormFeedback state={state} />
    </form>
  )
}
