"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { scanBadge, type ScanResult } from "@/lib/actions/sundaySchoolAttendance"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

const CONTAINER_ID = "ss-badge-reader"
// Ignore re-decodes of the same code while the child is still holding the badge up.
const REPEAT_MS = 3000

/**
 * Camera scanner for Sunday School badges. The dialog stays open so a teacher can
 * scan a queue of children; each decode calls `scanBadge` and shows the child's name
 * with "marked present" / "already marked", or the error. html5-qrcode loads
 * dynamically on open (it touches navigator/document), mirroring QrScanButton.
 * Sized for a 375px phone: the dialog is max-w-sm and the reader fills its width.
 */
export function BadgeScanner({ classId, date }: Readonly<{ classId: number; date: string }>) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null)
  const last = useRef<{ text: string; at: number }>({ text: "", at: 0 })
  const busy = useRef(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let started = false

    ;(async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode")
        if (cancelled) return
        const scanner = new Html5Qrcode(CONTAINER_ID)
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          async (decoded: string) => {
            const now = Date.now()
            if (cancelled || busy.current) return
            if (decoded === last.current.text && now - last.current.at < REPEAT_MS) return
            last.current = { text: decoded, at: now }
            busy.current = true
            try {
              const r = await scanBadge(classId, date, decoded)
              if (!cancelled) setResult(r)
              if (!("error" in r)) router.refresh()
            } catch {
              if (!cancelled) setResult({ error: "Could not mark this child. Try again." })
            } finally {
              busy.current = false
            }
          },
          () => {}, // per-frame decode failures are normal
        )
        started = true
        if (cancelled) {
          // Closed while the camera was starting: stop() throws mid-startup, so stop now.
          if (scannerRef.current === scanner) {
            scannerRef.current = null
            scanner.stop().then(() => scanner.clear()).catch(() => {})
          } else {
            scanner.stop().catch(() => {})
          }
        }
      } catch {
        if (!cancelled) setCameraError("Could not start the camera. Check camera permission and try again.")
      }
    })()

    return () => {
      cancelled = true
      const s = scannerRef.current
      if (s && started) {
        scannerRef.current = null
        s.stop().then(() => s.clear()).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, classId, date])

  function close() {
    setCameraError(null)
    setResult(null)
    last.current = { text: "", at: 0 }
    setOpen(false)
  }

  return (
    <>
      <Button variant="outline" onClick={() => { setCameraError(null); setResult(null); setOpen(true) }} className="whitespace-nowrap">
        Scan badges
      </Button>
      <Dialog open={open} onOpenChange={(next: boolean) => { if (!next) close() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Scan badges</DialogTitle>
          </DialogHeader>
          <div id={CONTAINER_ID} className="overflow-hidden rounded-lg" />
          {cameraError && <p role="alert" className="text-sm text-destructive">{cameraError}</p>}
          <div aria-live="polite" className="min-h-10 text-center text-sm">
            {result && ("error" in result ? (
              <p role="alert" className="font-medium text-destructive">{result.error}</p>
            ) : (
              <p className="font-medium text-income">
                {result.name}: {result.outcome === "marked" ? "marked present" : `already marked ${result.status.toLowerCase()}`}
              </p>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">Point the camera at a child&apos;s badge. Keep scanning; close when done.</p>
        </DialogContent>
      </Dialog>
    </>
  )
}
