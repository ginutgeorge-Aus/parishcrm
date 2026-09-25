"use client"

import { useEffect, useRef, useState } from "react"
import { extractRegToken } from "@/lib/eventCheckin"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

// Camera QR scanner for the check-in page. html5-qrcode is loaded
// dynamically on open so it never runs during SSR (it touches navigator/document)
// and stays out of the initial bundle. On a successful decode we extract the
// REG-… token and hand it up; the parent filters the attendee list to that party.
export function QrScanButton({ onScan }: { onScan: (token: string) => void }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Holds the Html5Qrcode instance so we can stop the camera on close/unmount.
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null)
  const containerId = "qr-reader"

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let started = false

    ;(async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode")
        if (cancelled) return
        const scanner = new Html5Qrcode(containerId)
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decoded: string) => {
            if (cancelled) return // dialog already closing — ignore a late decode
            const token = extractRegToken(decoded)
            if (!token) return // keep scanning until a registration code appears
            onScan(token)
            close()
          },
          () => {}, // per-frame decode failures are normal — ignore
        )
        started = true
        // Dialog closed while the camera was still starting up: cleanup ran before
        // the scanner was running (stop() throws mid-startup), so stop it now.
        if (cancelled) {
          if (scannerRef.current === scanner) {
            // Still the current scanner — safe to stop and clear its container.
            scannerRef.current = null
            scanner.stop().then(() => scanner.clear()).catch(() => {})
          } else {
            // A newer open cycle already mounted its scanner into the shared
            // container; stop() to release the camera but skip clear(), which
            // would wipe the replacement scanner's DOM.
            scanner.stop().catch(() => {})
          }
        }
      } catch {
        if (!cancelled) setError("Could not start the camera. Check camera permission and try again.")
      }
    })()

    return () => {
      cancelled = true
      const s = scannerRef.current
      // Only stop a scanner that finished starting; if startup is still pending the
      // post-start cancelled check above performs the stop (stop() throws otherwise).
      if (s && started) {
        scannerRef.current = null
        s.stop().then(() => s.clear()).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function close() {
    setError(null)
    setOpen(false)
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => { setError(null); setOpen(true) }}
        className="whitespace-nowrap"
      >
        Scan QR
      </Button>

      {/* shadcn Dialog gives a focus trap, Escape-to-close, initial focus and
          tokenised surface — the hand-rolled overlay had none of these. */}
      <Dialog open={open} onOpenChange={(next: boolean) => { if (!next) close() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Scan check-in QR</DialogTitle>
          </DialogHeader>
          <div id={containerId} className="overflow-hidden rounded-lg" />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <p className="text-center text-xs text-muted-foreground">Point the camera at the attendee&apos;s check-in code.</p>
        </DialogContent>
      </Dialog>
    </>
  )
}
