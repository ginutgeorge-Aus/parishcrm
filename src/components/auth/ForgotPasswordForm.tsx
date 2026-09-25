"use client"

import { useActionState } from "react"
import Link from "next/link"
import { requestPasswordReset } from "@/lib/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"

// Client form for the forgot-password page. Split out of the page so the
// page can be a Server Component that reads getChurchSettings() and passes the
// configured church name into AuthCard's logo alt text.
export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string; success?: true } | undefined, formData: FormData) => {
      return requestPasswordReset(formData.get("email") as string)
    },
    undefined
  )
  const sent = state?.success

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Forgot password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>
      {sent ? (
        <div role="status" className="rounded-md bg-success/10 border border-success/40 p-3 text-sm text-success">
          If your email is registered, you&apos;ll receive a reset link shortly.
        </div>
      ) : (
        <form action={action} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              aria-invalid={state?.error ? true : undefined}
              aria-describedby={state?.error ? "forgot-error" : undefined}
            />
          </div>
          <FormFeedback state={{ error: state?.error }} id="forgot-error" />
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="inline-flex min-h-11 items-center px-2 underline hover:text-foreground">Back to sign in</Link>
      </p>
    </>
  )
}
