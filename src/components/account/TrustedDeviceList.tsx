"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { revokeTrustedDevice } from "@/lib/actions/trustedDevice"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"

type Device = { id: string; label: string | null; createdAt: Date; lastUsedAt: Date }

export function TrustedDeviceList({ devices }: { devices: Device[] }) {
  const [list, setList] = useState(devices)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (list.length === 0) {
    return <p className="text-sm text-muted-foreground">No trusted devices. You&apos;ll be asked for a code on every login.</p>
  }

  function revoke(id: string) {
    setError(null)
    startTransition(async () => {
      try {
        // Only drop the row once the server confirms the delete — a 0-row match
        // returns success, an authz/validation failure returns {error}, and a
        // transport throw lands in catch. Never remove on an unconfirmed revoke,
        // or a device that still bypasses OTP would look revoked.
        const result = await revokeTrustedDevice(id)
        if (result && "error" in result) {
          setError(result.error)
          return
        }
        setList((cur) => cur.filter((d) => d.id !== id))
      } catch {
        setError("Something went wrong, try again")
      }
    })
  }

  return (
    <>
    <ul className="divide-y divide-gray-200 rounded-md border">
      {list.map((d) => (
        <li key={d.id} className="flex items-center justify-between gap-4 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{d.label ?? "Unknown device"}</p>
            <p className="text-xs text-muted-foreground">
              Last used {new Date(d.lastUsedAt).toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE })}
            </p>
          </div>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => revoke(d.id)}>
            Revoke
          </Button>
        </li>
      ))}
    </ul>
    {error && <p role="alert" className="text-sm text-destructive mt-2">{error}</p>}
    </>
  )
}
