"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"
import { resetPassword } from "@/lib/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string; success?: true } | undefined, formData: FormData) => {
      const password = formData.get("password") as string
      const confirm = formData.get("confirm") as string
      if (password !== confirm) return { error: "Passwords do not match." }
      try {
        return await resetPassword(token, password)
      } catch {
        // Transport/DB-level rejection — resetPassword can throw before it
        // resolves to a {error}; surface a retry instead of crashing the form
        // to the route error boundary.
        return { error: "Something went wrong. Please try again." }
      }
    },
    undefined
  )
  const router = useRouter()
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const invalid = state?.error ? true : undefined
  useEffect(() => {
    if (state?.success) router.push("/login?reset=1")
  }, [state, router])

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="password">New password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPw ? "text" : "password"}
            required
            autoComplete="new-password"
            aria-describedby={invalid ? "password-help reset-error" : "password-help"}
            aria-invalid={invalid}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? "Hide password" : "Show password"}
            aria-pressed={showPw}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p id="password-help" className="text-xs text-muted-foreground">
          Min 8 chars with uppercase, lowercase, number, and special character
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="confirm">Confirm password</Label>
        <div className="relative">
          <Input
            id="confirm"
            name="confirm"
            type={showConfirm ? "text" : "password"}
            required
            autoComplete="new-password"
            placeholder="Repeat new password"
            aria-invalid={invalid}
            aria-describedby={invalid ? "reset-error" : undefined}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            aria-label={showConfirm ? "Hide password" : "Show password"}
            aria-pressed={showConfirm}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
          >
            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <FormFeedback state={{ error: state?.error }} id="reset-error" />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  )
}
