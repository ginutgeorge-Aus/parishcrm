"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { uploadBranding, resetBranding } from "@/lib/actions/branding"

// Raster only — the upload action rejects SVG (stored-XSS via same-origin serve).
const ACCEPT = "image/png,image/jpeg,image/webp"

const SLOTS: { param: string; label: string; hint: string }[] = [
  { param: "logo", label: "Logo", hint: "Login screen + sidebar (PNG, ~512×466)" },
  { param: "crest", label: "Crest", hint: "Sidebar + organiser header (PNG)" },
  { param: "crest-header", label: "Crest (header)", hint: "Public page header (PNG)" },
  { param: "icon", label: "App icon / favicon", hint: "PWA + browser tab (PNG, 512×512)" },
  { param: "letterhead", label: "Letterhead", hint: "PDF banner across receipts + letters (wide PNG)" },
]

export function BrandingForm() {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<Record<string, { error?: string; success?: string }>>({})
  // Bump per-slot to bust the <img> cache after a successful upload/reset.
  const [ver, setVer] = useState<Record<string, number>>({})

  const run = (param: string, fn: () => Promise<{ error: string } | { success: string } | undefined>) =>
    start(async () => {
      const r = await fn()
      if (r && "error" in r) setMsg((m) => ({ ...m, [param]: { error: r.error } }))
      else {
        setMsg((m) => ({ ...m, [param]: { success: r?.success ?? "Updated." } }))
        setVer((v) => ({ ...v, [param]: (v[param] ?? 0) + 1 }))
      }
    })

  return (
    <section>
      <h3 className="text-base font-semibold text-foreground mb-1">Branding</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Upload your church&rsquo;s images. Each replaces the built-in placeholder everywhere it appears:
        the login screen, sidebar, public pages, browser tab, and PDF letterheads. Reset restores
        the neutral default.
      </p>
      <div className="space-y-6">
        {SLOTS.map((s) => {
          const m = msg[s.param]
          return (
            <div key={s.param} className="flex items-start gap-4">
              {/* Plain <img>: the source is a dynamic, sometimes-SVG API route that next/image can't optimise. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/branding/${s.param}?v=${ver[s.param] ?? 0}`}
                alt={`${s.label} preview`}
                className="h-12 w-12 shrink-0 rounded border border-border bg-muted object-contain"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.hint}</div>
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  action={(fd) => run(s.param, () => uploadBranding(s.param, fd))}
                >
                  <input
                    type="file"
                    name="file"
                    accept={ACCEPT}
                    required
                    aria-label={`Upload ${s.label} image`}
                    className="min-h-11 text-xs file:mr-2 file:min-h-9 file:rounded file:border file:border-border file:bg-background file:px-3 file:py-2 file:text-xs"
                  />
                  <Button type="submit" className="min-h-11" disabled={pending}>Upload</Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={pending}
                    onClick={() => run(s.param, () => resetBranding(s.param))}
                  >
                    Reset
                  </Button>
                </form>
                <FormFeedback state={m} className="mt-1 text-xs" />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
