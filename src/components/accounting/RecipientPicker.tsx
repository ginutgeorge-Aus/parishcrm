"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { createCustomerInline } from "@/lib/actions/customer"

export type RecipientOption = { kind: "person" | "customer"; id: number; name: string }
type Value = { kind: "person" | "customer" | "none"; id: number | null; name: string }

/** Searchable picker over members and saved customers, with inline "+ New customer". */
export function RecipientPicker({ options, value, onPick, onCreated }: Readonly<{
  options: RecipientOption[]; value: Value; onPick: (o: RecipientOption | null) => void; onCreated: (o: RecipientOption) => void
}>) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: "", email: "", address: "" })
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const people = options.filter((o) => o.kind === "person")
  const customers = options.filter((o) => o.kind === "customer")

  async function create() {
    if (saving) return
    setErr(null)
    setSaving(true)
    const res = await createCustomerInline(draft).finally(() => setSaving(false))
    if ("error" in res) { setErr(res.error); return }
    const opt: RecipientOption = { kind: "customer", id: res.id, name: res.name }
    onCreated(opt)
    setCreating(false); setOpen(false); setDraft({ name: "", email: "", address: "" })
  }

  const item = (o: RecipientOption) => (
    <CommandItem key={`${o.kind}-${o.id}`} value={`${o.name}\u0000${o.kind}${o.id}`} onSelect={() => { onPick(o); setOpen(false) }}>
      {o.name}
    </CommandItem>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-label="Choose recipient" className="w-full justify-start">
          {value.kind === "none" ? "Pick a member or customer (optional)" : value.name}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem] p-0">
        {creating ? (
          <div className="space-y-2 p-3">
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
            <Input aria-label="New customer name" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Input aria-label="New customer email" placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            <Input aria-label="New customer address" placeholder="Address" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={create} disabled={saving}>{saving ? "Saving…" : "Save customer"}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Command>
            <CommandInput placeholder="Search people and customers…" />
            <CommandList>
              <CommandEmpty>No match.</CommandEmpty>
              {customers.length > 0 && <CommandGroup heading="Customers">{customers.map(item)}</CommandGroup>}
              {people.length > 0 && <CommandGroup heading="People">{people.map(item)}</CommandGroup>}
              <CommandGroup>
                <CommandItem value="__new_customer" onSelect={() => setCreating(true)}>+ New customer</CommandItem>
                {value.kind !== "none" && <CommandItem value="__clear" onSelect={() => { onPick(null); setOpen(false) }}>Clear (type recipient manually)</CommandItem>}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}
