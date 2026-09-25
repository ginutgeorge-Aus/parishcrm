"use client"

import { useEffect, useRef, useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { trustDevice } from "@/lib/actions/trustedDevice"

export function LoginForm({ churchName }: { churchName: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const didReset = searchParams.get("reset") === "1"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [otp, setOtp] = useState("")
  const [step, setStep] = useState<"password" | "otp">("password")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendMsg, setResendMsg] = useState("")
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  // Client-side mirror of the server's 15-min lockout so the submit/resend
  // buttons visibly disable with a live countdown instead of re-enabling and
  // inviting futile retries against a locked account. Approximate: we
  // start the clock at the moment the AccountLocked response lands, not at the
  // server's actual lock time — close enough for a "stop clicking" cue.
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)
  const [nowTs, setNowTs] = useState(() => Date.now())
  const otpRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const firstRender = useRef(true)

  const lockRemainingMs = lockedUntil ? Math.max(0, lockedUntil - nowTs) : 0
  const isLocked = lockRemainingMs > 0
  const lockCountdown = (() => {
    const s = Math.ceil(lockRemainingMs / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
  })()

  // Tick once a second while locked; clear the lock (stopping the interval) the
  // moment it elapses so the buttons re-enable on their own.
  useEffect(() => {
    if (lockedUntil === null) return
    const id = setInterval(() => {
      if (Date.now() >= lockedUntil) setLockedUntil(null)
      else setNowTs(Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [lockedUntil])

  const LOCKOUT_MS = 15 * 60 * 1000
  const lockNow = () => {
    // Sync nowTs so the countdown shows the full duration immediately instead of
    // a stale value until the first 1s interval tick.
    setNowTs(Date.now())
    setLockedUntil(Date.now() + LOCKOUT_MS)
  }

  // On step change, move focus to the newly mounted form so keyboard/screen-
  // reader users get a cue (the focused control was unmounted). Skip the initial
  // render so we don't steal focus from the email field on page load.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    if (step === "otp") otpRef.current?.focus()
    else passwordRef.current?.focus()
  }, [step])

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setResendMsg("")
    setLoading(true)

    try {
      const result = await signIn("credentials", { email, password, mode: "password", remember: remember ? "true" : "false", redirect: false })

      if (result?.code === "OtpSent") {
        setStep("otp")
      } else if (result?.code === "OtpCooldown") {
        // A code was already sent within the cooldown window — advance to the OTP
        // step and tell the user rather than silently no-op'ing the submit.
        setResendMsg("A code was already sent — check your inbox.")
        setStep("otp")
      } else if (result?.code === "AccountLocked") {
        setError("Account locked after too many failed attempts. Try again in 15 minutes.")
        lockNow()
      } else if (result?.code === "OtpDeliveryFailed") {
        // Password was correct but the verification email failed to send. Stay on
        // the password step (the stored code was rolled back) so the user can
        // retry immediately rather than waiting behind the resend cooldown.
        setError("We couldn't send your verification code. Please try again in a moment.")
      } else if (result?.error) {
        setError("Invalid email or password")
      } else if (result?.ok) {
        router.push("/")
        router.refresh()
      }
    } catch {
      // A transport-level failure (network drop, DNS, 5xx from the proxy)
      // rejects the signIn promise before it can resolve to a {code}/{error}
      // object; surface a retry message so the button isn't left stuck on
      // "Signing in…" with no feedback.
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    setResendMsg("")
    // Clear any stale verify error so "New code sent." doesn't render alongside
    // "Invalid or expired code." — the two together read as contradictory.
    setError("")
    setResendLoading(true)
    try {
      const result = await signIn("credentials", { email, password, mode: "password", remember: remember ? "true" : "false", redirect: false })
      if (result?.code === "OtpSent") {
        setResendMsg("New code sent.")
        setOtp("")
      } else if (result?.code === "OtpCooldown") {
        setResendMsg("Please wait 30 seconds before requesting a new code.")
      } else if (result?.code === "AccountLocked") {
        // The resend re-runs the password credential and can trip the lockout —
        // show the same 15-min message the submit handlers do, not a generic
        // "try again" that invites retries against a locked account.
        setResendMsg("Account locked after too many failed attempts. Try again in 15 minutes.")
        lockNow()
      } else {
        setResendMsg("Failed to resend. Try again.")
      }
    } catch {
      // Transport-level rejection — same class as handlePasswordSubmit.
      setResendMsg("Failed to resend. Try again.")
    } finally {
      setResendLoading(false)
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    // Clear a prior "New code sent." so it doesn't linger next to a fresh verify
    // error on resubmit.
    setResendMsg("")
    setLoading(true)

    try {
      const result = await signIn("credentials", { email, otp, mode: "otp", remember: remember ? "true" : "false", redirect: false })

      if (result?.code === "AccountLocked") {
        setError("Account locked after too many failed attempts. Try again in 15 minutes.")
        lockNow()
      } else if (result?.error) {
        setError("Invalid or expired code.")
      } else {
        if (remember) {
          await trustDevice().catch(() => {}) // best-effort; never block login on trust failure
        }
        router.push("/")
        router.refresh()
      }
    } catch {
      // Transport-level rejection — same class as handlePasswordSubmit.
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1 className="sr-only">{churchName}</h1>
          <Image
            src="/api/branding/logo"
            alt={churchName}
            width={512}
            height={466}
            priority
            unoptimized
            className="mx-auto h-auto w-48"
          />
        </CardTitle>
        <p className="text-center text-sm text-muted-foreground mt-1">
          CRM{process.env.NEXT_PUBLIC_APP_VERSION ? ` · ${process.env.NEXT_PUBLIC_APP_VERSION}` : ""}
        </p>
      </CardHeader>
      <CardContent>
        {didReset && (
          <div className="mb-4 rounded-md bg-success/10 border border-success/40 p-3 text-sm text-success">
            Password updated. Please sign in with your new password.
          </div>
        )}
        {step === "password" ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  ref={passwordRef}
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "login-error" : undefined}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={remember}
                onCheckedChange={(checked: boolean | "indeterminate") => setRemember(checked === true)}
              />
              <Label htmlFor="remember" className="text-sm font-normal text-muted-foreground">
                Remember this device (skip the code for 14 days)
              </Label>
            </div>
            <div className="text-right">
              <Link href="/forgot-password" className="inline-flex items-center min-h-11 min-w-[44px] text-xs text-muted-foreground hover:underline">
                Forgot password?
              </Link>
            </div>
            <FormFeedback state={{ error }} id="login-error" />
            <Button type="submit" className="w-full" disabled={loading || isLocked}>
              {loading ? "Signing in…" : isLocked ? `Locked · ${lockCountdown}` : "Sign in"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <button
              type="button"
              aria-label="Back to password step"
              onClick={() => { setStep("password"); setOtp(""); setError("") }}
              className="inline-flex items-center min-h-11 min-w-[44px] gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <span aria-hidden="true">←</span> Back
            </button>
            <p className="text-sm text-muted-foreground">
              A 6-digit code was sent to <strong className="break-all">{email}</strong>.
            </p>
            <div className="space-y-2">
              <Label htmlFor="otp">Verification code</Label>
              <Input
                ref={otpRef}
                id="otp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                autoComplete="one-time-code"
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "otp-error" : undefined}
              />
            </div>
            <FormFeedback state={{ error }} id="otp-error" />
            {resendMsg && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{resendMsg}</p>}
            <Button type="submit" className="w-full" disabled={loading || isLocked}>
              {loading ? "Verifying…" : isLocked ? `Locked · ${lockCountdown}` : "Verify"}
            </Button>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendLoading || isLocked}
              className="inline-flex items-center justify-center min-h-11 w-full text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {resendLoading ? "Sending…" : "Resend code"}
            </button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
