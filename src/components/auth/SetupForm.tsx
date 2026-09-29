"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createFirstAdmin, type SetupField } from "@/lib/actions/setup"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"

// React 19 resets the form after every action, so non-secret fields (and the
// long token) are echoed back as defaultValues; passwords are left to clear.
type Values = { token: string; name: string; email: string }
type State = { error?: string; field?: SetupField; success?: true; values?: Values } | undefined

export function SetupForm() {
  const [state, action, pending] = useActionState(async (_prev: State, formData: FormData): Promise<State> => {
    const values: Values = {
      token: String(formData.get("token") ?? ""),
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
    }
    if (formData.get("password") !== formData.get("confirm")) {
      return { error: "Passwords do not match.", field: "confirm", values }
    }
    try {
      return { ...(await createFirstAdmin(formData)), values }
    } catch {
      return { error: "Something went wrong. Please try again.", values }
    }
  }, undefined)
  const router = useRouter()
  useEffect(() => {
    if (state?.success) router.push("/login?setup=1")
  }, [state, router])
  // aria-invalid + aria-describedby only on the field the error is about.
  const errProps = (f: SetupField) =>
    state?.error && state.field === f ? { "aria-invalid": true, "aria-describedby": "setup-error" } : {}

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="token">Setup token</Label>
        <Input id="token" name="token" type="password" required autoComplete="off"
          defaultValue={state?.values?.token} {...errProps("token")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" required autoComplete="name" maxLength={200}
          defaultValue={state?.values?.name} {...errProps("name")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" maxLength={254}
          defaultValue={state?.values?.email} {...errProps("email")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required autoComplete="new-password"
          maxLength={128} {...errProps("password")}
          aria-describedby={state?.field === "password" ? "password-help setup-error" : "password-help"} />
        <p id="password-help" className="text-xs text-muted-foreground">
          Min 8 chars with uppercase, lowercase, number, and special character
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" required autoComplete="new-password" maxLength={128}
          {...errProps("confirm")} />
      </div>
      <FormFeedback state={{ error: state?.error }} id="setup-error" />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create administrator"}
      </Button>
    </form>
  )
}
