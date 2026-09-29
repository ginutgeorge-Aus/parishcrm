"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createFirstAdmin } from "@/lib/actions/setup"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"

type State = { error?: string; success?: true } | undefined

export function SetupForm() {
  const [state, action, pending] = useActionState(async (_prev: State, formData: FormData): Promise<State> => {
    if (formData.get("password") !== formData.get("confirm")) return { error: "Passwords do not match." }
    try {
      return await createFirstAdmin(formData)
    } catch {
      return { error: "Something went wrong. Please try again." }
    }
  }, undefined)
  const router = useRouter()
  useEffect(() => {
    if (state?.success) router.push("/login?setup=1")
  }, [state, router])
  const invalid = state?.error ? true : undefined

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="token">Setup token</Label>
        <Input id="token" name="token" type="password" required autoComplete="off" aria-invalid={invalid} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" required autoComplete="name" maxLength={200} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" maxLength={254} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required autoComplete="new-password"
          aria-describedby="password-help" maxLength={128} />
        <p id="password-help" className="text-xs text-muted-foreground">
          Min 8 chars with uppercase, lowercase, number, and special character
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" required autoComplete="new-password" maxLength={128} />
      </div>
      <FormFeedback state={{ error: state?.error }} id="setup-error" />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create administrator"}
      </Button>
    </form>
  )
}
