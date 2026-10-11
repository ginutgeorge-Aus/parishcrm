"use client"

import { startTransition, useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createCustomer, updateCustomer, type CustomerView } from "@/lib/actions/customer"

/** Create/edit form for a saved outside customer. */
export default function CustomerForm({ edit }: Readonly<{ edit?: CustomerView }>) {
  const action = edit ? updateCustomer.bind(null, edit.id) : createCustomer
  const [state, formAction, isPending] = useActionState(action, undefined)
  const field = (name: keyof CustomerView, label: string, type = "text") => (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={(edit?.[name] as string | null) ?? ""} />
    </div>
  )
  return (
    <form
      className="max-w-xl space-y-4"
      // onSubmit, not action={formAction}: React 19 resets uncontrolled fields after a form
      // action, which would wipe the user's input when the server rejects the save.
      onSubmit={(e) => {
        e.preventDefault()
        const data = new FormData(e.currentTarget)
        startTransition(() => formAction(data))
      }}
    >
      {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      {field("name", "Name")}
      {field("abn", "ABN (optional)")}
      {field("email", "Email", "email")}
      {field("phone", "Phone")}
      <div className="space-y-1">
        <Label htmlFor="address">Address</Label>
        <Textarea id="address" name="address" rows={3} defaultValue={edit?.address ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={edit?.notes ?? ""} />
      </div>
      <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save customer"}</Button>
    </form>
  )
}
