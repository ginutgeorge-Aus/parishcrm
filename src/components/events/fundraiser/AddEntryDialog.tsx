"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { addEntry } from "@/lib/actions/fundraiser"

/**
 * Dialog to add a member family or an outside buyer to the fundraiser.
 * Exactly one of family / outside name is sent. Server errors are shown inline.
 *
 * @param props.fundraiserId - Fundraiser id.
 * @param props.families - Selectable families (id + name).
 * @param props.hasDelivery - Fundraiser has a delivery price: show the Pickup/Delivery choice.
 */
export function AddEntryDialog({
  fundraiserId, families, hasDelivery = false,
}: Readonly<{ fundraiserId: number; families: { id: number; name: string }[]; hasDelivery?: boolean }>) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"member" | "outside">("member")
  const [familyId, setFamilyId] = useState("")
  const [outsideName, setOutsideName] = useState("")
  const [outsideEmail, setOutsideEmail] = useState("")
  const [outsidePhone, setOutsidePhone] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [delivery, setDelivery] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  /** Submit the new entry; close and reset on success. */
  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    start(async () => {
      let res: Awaited<ReturnType<typeof addEntry>>
      try {
        res = await addEntry(
          fundraiserId,
          mode === "member"
            ? { familyId: familyId ? Number.parseInt(familyId, 10) : undefined, quantity, ...(hasDelivery && { delivery }) }
            : { outsideName, outsideEmail, outsidePhone, quantity, ...(hasDelivery && { delivery }) },
        )
      } catch {
        setError("Could not add the entry. Please try again.")
        return
      }
      if (res?.error) { setError(res.error); return }
      setOpen(false)
      setFamilyId(""); setOutsideName(""); setOutsideEmail(""); setOutsidePhone(""); setQuantity("1"); setDelivery(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Add entry</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add entry</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={mode === "member" ? "default" : "outline"} onClick={() => setMode("member")}>Member</Button>
            <Button type="button" size="sm" variant={mode === "outside" ? "default" : "outline"} onClick={() => setMode("outside")}>Outside buyer</Button>
          </div>
          {mode === "member" ? (
            <div className="space-y-1">
              <Label htmlFor="fe-family">Family</Label>
              <select
                id="fe-family"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={familyId}
                onChange={(e) => setFamilyId(e.target.value)}
                required
              >
                <option value="">Select a family</option>
                {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="fe-name">Name</Label>
                <Input id="fe-name" value={outsideName} onChange={(e) => setOutsideName(e.target.value)} maxLength={120} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fe-email">Email (optional)</Label>
                <Input id="fe-email" type="email" value={outsideEmail} onChange={(e) => setOutsideEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fe-phone">Phone (optional)</Label>
                <Input id="fe-phone" type="tel" value={outsidePhone} onChange={(e) => setOutsidePhone(e.target.value)} />
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label htmlFor="fe-qty">Quantity</Label>
            <Input id="fe-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </div>
          {hasDelivery && (
            <div className="space-y-1">
              <Label htmlFor="fe-delivery">Pickup or delivery</Label>
              <select
                id="fe-delivery"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={delivery ? "delivery" : "pickup"}
                onChange={(e) => setDelivery(e.target.value === "delivery")}
              >
                <option value="pickup">Pickup</option>
                <option value="delivery">Delivery</option>
              </select>
            </div>
          )}
          <FormFeedback state={{ error }} />
          <Button type="submit" disabled={pending}>{pending ? "Adding..." : "Add entry"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
