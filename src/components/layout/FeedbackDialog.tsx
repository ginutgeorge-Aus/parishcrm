"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { MessageSquarePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { submitFeedback, type FeedbackInput } from "@/lib/actions/feedback"

type FeedbackType = "BUG" | "FEATURE" | "SUGGESTION"

const TYPES: { value: FeedbackType; label: string }[] = [
  { value: "BUG", label: "Bug" },
  { value: "FEATURE", label: "Feature" },
  { value: "SUGGESTION", label: "Idea" },
]

function captureClientContext() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return undefined
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    screen: `${window.screen.width}×${window.screen.height}`,
    dpr: window.devicePixelRatio,
  }
}

export function FeedbackDialog({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<FeedbackType>("BUG")
  const [whatDoing, setWhatDoing] = useState("")
  const [whatExpected, setWhatExpected] = useState("")
  const [whatHappened, setWhatHappened] = useState("")
  const [what, setWhat] = useState("")
  const [why, setWhy] = useState("")
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Bumped whenever the dialog closes, so a submit that resolves after the user
  // closed (and possibly reopened) the dialog can't write its banner or arm the
  // auto-close over the new draft session.
  const submitSession = useRef(0)

  // Clear the success auto-close timer if the dialog unmounts before it fires.
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  function reset() {
    setType("BUG")
    setWhatDoing("")
    setWhatExpected("")
    setWhatHappened("")
    setWhat("")
    setWhy("")
    setMessage(null)
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      // Invalidate any in-flight submit so its resolution is ignored.
      submitSession.current++
      if (closeTimer.current) {
        clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
      reset()
    }
  }

  const isBug = type === "BUG"
  const canSubmit = isBug
    ? whatDoing.trim() && whatExpected.trim() && whatHappened.trim()
    : what.trim()

  function handleSubmit() {
    setMessage(null)
    const client = captureClientContext()
    const input: FeedbackInput = isBug
      ? { type, whatDoing, whatExpected, whatHappened, pageUrl: pathname, client }
      : { type, what, why: why.trim() || undefined, pageUrl: pathname, client }
    const session = submitSession.current
    startTransition(async () => {
      const result = await submitFeedback(input)
      // Drop the result if the dialog was closed (and maybe reopened) meanwhile.
      if (session !== submitSession.current) return
      if (result && "success" in result) {
        setMessage({ type: "success", text: result.success })
        closeTimer.current = setTimeout(() => handleOpenChange(false), 2500)
      } else {
        setMessage({
          type: "error",
          text: (result && "error" in result && result.error) || "Could not file report. Try again later.",
        })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <button
                aria-label="Feedback"
                className="flex items-center justify-center w-full px-2 py-2 rounded-md text-sm text-primary-foreground/70 hover:bg-white/10 hover:text-primary-foreground transition-colors"
              >
                <MessageSquarePlus className="w-4 h-4" />
              </button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Feedback</TooltipContent>
        </Tooltip>
      ) : (
        <DialogTrigger asChild>
          <button className="flex items-center gap-3 px-3 py-2 w-full rounded-md text-sm text-primary-foreground/70 hover:bg-white/10 hover:text-primary-foreground transition-colors">
            <MessageSquarePlus className="w-4 h-4" />
            Feedback
          </button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send Feedback</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="group" aria-label="Feedback type">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={type === t.value}
                onClick={() => setType(t.value)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm transition-colors transition-transform active:scale-95 motion-reduce:active:scale-100",
                  type === t.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {isBug ? (
            <>
              <div>
                <Label htmlFor="bug-doing">What were you doing?</Label>
                <Textarea id="bug-doing" value={whatDoing} onChange={(e) => setWhatDoing(e.target.value)}
                  maxLength={500} placeholder="e.g. Adding a new family" className="mt-1 min-h-20" />
              </div>
              <div>
                <Label htmlFor="bug-expected">What did you expect?</Label>
                <Textarea id="bug-expected" value={whatExpected} onChange={(e) => setWhatExpected(e.target.value)}
                  maxLength={500} placeholder="e.g. The family to appear in the list" className="mt-1 min-h-20" />
              </div>
              <div>
                <Label htmlFor="bug-happened">What actually happened?</Label>
                <Textarea id="bug-happened" value={whatHappened} onChange={(e) => setWhatHappened(e.target.value)}
                  maxLength={500} placeholder="e.g. A red error message appeared" className="mt-1 min-h-20" />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label htmlFor="fb-what">
                  {type === "FEATURE" ? "What would you like added?" : "What's your idea?"}
                </Label>
                <Textarea id="fb-what" value={what} onChange={(e) => setWhat(e.target.value)}
                  maxLength={500} placeholder="e.g. A dark mode for evening use" className="mt-1 min-h-20" />
              </div>
              <div>
                <Label htmlFor="fb-why">Why would it help? (optional)</Label>
                <Textarea id="fb-why" value={why} onChange={(e) => setWhy(e.target.value)}
                  maxLength={500} placeholder="e.g. Easier on the eyes at night" className="mt-1 min-h-20" />
              </div>
            </>
          )}

          <p className="text-xs text-muted-foreground">
            We automatically include your browser details to help us. Please don&apos;t paste
            sensitive member data (names, contact details).
          </p>
          {message && (
            <div
              role={message.type === "success" ? "status" : "alert"}
              aria-live="polite"
              className={`text-sm ${message.type === "success" ? "text-success" : "text-destructive"}`}
            >
              <p>{message.text}</p>
              {message.type === "success" && (
                <Link href="/reports" className="underline" onClick={() => handleOpenChange(false)}>
                  View your reports
                </Link>
              )}
            </div>
          )}
          <Button onClick={handleSubmit} disabled={!canSubmit || isPending} className="w-full">
            Submit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
