"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { sendSingleReceipt } from "@/lib/actions/receipt"
import { Mail } from "lucide-react"

export function SendReceiptDialog({
  transactionId,
  defaultEmail,
}: {
  transactionId: number
  defaultEmail: string | null
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(defaultEmail ?? "")
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending auto-close timer on unmount so a fired timeout never
  // touches an unmounted component.
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  function handleSend() {
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await sendSingleReceipt(transactionId, email)
        if ("success" in result) {
          setMessage({ type: "success", text: result.success })
          closeTimer.current = setTimeout(() => setOpen(false), 1500)
        } else {
          setMessage({ type: "error", text: result.error })
        }
      } catch {
        // Transport-level throw never reaches the else branch — surface a retry
        // message so the dialog can't sit idle after a failed send.
        setMessage({ type: "error", text: "Something went wrong, try again" })
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        // Manual close cancels the pending auto-close timer.
        if (!next && closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Mail className="w-4 h-4 mr-2" />
          Send Receipt
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Send Receipt</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="receipt-email">Recipient email</Label>
            <Input
              id="receipt-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="recipient@example.com"
              className="mt-1"
            />
          </div>
          {message && (
            <p role={message.type === "success" ? "status" : "alert"} className={`text-sm ${message.type === "success" ? "text-success" : "text-destructive"}`}>
              {message.text}
            </p>
          )}
          <Button onClick={handleSend} disabled={!email || isPending} className="w-full">
            Send
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
