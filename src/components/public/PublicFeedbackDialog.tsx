"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { usePathname } from "next/navigation"
import { MessageSquarePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { TurnstileWidget } from "@/components/public/TurnstileWidget"
import { submitPublicFeedback, type PublicFeedbackInput } from "@/lib/actions/publicFeedback"

import { TURNSTILE_SITE_KEY } from "@/lib/appConfig"

type FeedbackType = "BUG" | "FEEDBACK"
const TYPES: { value: FeedbackType; label: string }[] = [
  { value: "BUG", label: "Bug" },
  { value: "FEEDBACK", label: "Feedback" },
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

export function PublicFeedbackDialog() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<FeedbackType>("BUG")
  const [whatDoing, setWhatDoing] = useState("")
  const [whatExpected, setWhatExpected] = useState("")
  const [whatHappened, setWhatHappened] = useState("")
  const [what, setWhat] = useState("")
  const [why, setWhy] = useState("")
  const [email, setEmail] = useState("")
  const [website, setWebsite] = useState("") // honeypot
  const [token, setToken] = useState("")
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  function reset() {
    setType("BUG")
    setWhatDoing("")
    setWhatExpected("")
    setWhatHappened("")
    setWhat("")
    setWhy("")
    setEmail("")
    setWebsite("")
    setToken("")
    setMessage(null)
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
      reset()
    }
  }

  const isBug = type === "BUG"
  const turnstileSolved = !TURNSTILE_SITE_KEY || token.length > 0
  const canSubmit =
    turnstileSolved &&
    Boolean(isBug ? whatDoing.trim() && whatExpected.trim() && whatHappened.trim() : what.trim())

  function handleSubmit() {
    setMessage(null)
    const client = captureClientContext()
    const input: PublicFeedbackInput = isBug
      ? {
          type: "BUG",
          whatDoing,
          whatExpected,
          whatHappened,
          reporterEmail: email.trim(),
          pageUrl: pathname,
          turnstileToken: token,
          website,
          client,
        }
      : {
          type: "FEEDBACK",
          what,
          why: why.trim() || undefined,
          reporterEmail: email.trim(),
          pageUrl: pathname,
          turnstileToken: token,
          website,
          client,
        }
    startTransition(async () => {
      const result = await submitPublicFeedback(input)
      if (result && "success" in result) {
        setMessage({ type: "success", text: result.success })
        closeTimer.current = setTimeout(() => handleOpenChange(false), 3000)
      } else {
        setMessage({
          type: "error",
          text: (result && "error" in result && result.error) || "Could not send. Please try again later.",
        })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-2 min-h-11 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <MessageSquarePlus className="w-4 h-4" />
          Report a problem / feedback
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report a problem or send feedback</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Feedback type">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={type === t.value}
                onClick={() => setType(t.value)}
                className={cn(
                  "rounded-md border px-3 py-1.5 min-h-11 min-w-11 text-sm transition-colors",
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
                <Label htmlFor="pf-doing">What were you doing?</Label>
                <Textarea
                  id="pf-doing"
                  value={whatDoing}
                  onChange={(e) => setWhatDoing(e.target.value)}
                  maxLength={500}
                  className="mt-1 min-h-20"
                />
              </div>
              <div>
                <Label htmlFor="pf-expected">What did you expect?</Label>
                <Textarea
                  id="pf-expected"
                  value={whatExpected}
                  onChange={(e) => setWhatExpected(e.target.value)}
                  maxLength={500}
                  className="mt-1 min-h-20"
                />
              </div>
              <div>
                <Label htmlFor="pf-happened">What actually happened?</Label>
                <Textarea
                  id="pf-happened"
                  value={whatHappened}
                  onChange={(e) => setWhatHappened(e.target.value)}
                  maxLength={500}
                  className="mt-1 min-h-20"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label htmlFor="pf-what">Your feedback</Label>
                <Textarea
                  id="pf-what"
                  value={what}
                  onChange={(e) => setWhat(e.target.value)}
                  maxLength={500}
                  className="mt-1 min-h-20"
                />
              </div>
              <div>
                <Label htmlFor="pf-why">Why would it help? (optional)</Label>
                <Textarea
                  id="pf-why"
                  value={why}
                  onChange={(e) => setWhy(e.target.value)}
                  maxLength={500}
                  className="mt-1 min-h-20"
                />
              </div>
            </>
          )}

          <div>
            <Label htmlFor="pf-email">Your email (optional — so we can reply)</Label>
            <Input
              id="pf-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
              className="mt-1"
            />
          </div>

          {/* Honeypot — hidden from users, filled by bots. */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="hidden"
          />

          <TurnstileWidget onToken={setToken} />

          <p className="text-xs text-muted-foreground">
            Please don&apos;t include sensitive personal data. We include your browser details to help us.
          </p>
          {message && (
            <p
              role={message.type === "success" ? "status" : "alert"}
              aria-live="polite"
              className={cn("text-sm", message.type === "success" ? "text-success" : "text-destructive")}
            >
              {message.text}
            </p>
          )}
          <Button onClick={handleSubmit} disabled={!canSubmit || isPending} className="w-full">
            Submit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
