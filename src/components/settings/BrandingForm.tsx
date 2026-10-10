"use client"

import { useState, useTransition, type ChangeEvent, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { uploadBranding, resetBranding } from "@/lib/actions/branding"

// Raster only — the upload action rejects SVG (stored-XSS via same-origin serve).
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"]
const ACCEPT = ACCEPTED_TYPES.join(",")
// Mirrors the server cap in uploadBranding; checked here so a too-big file fails fast.
const MAX_BYTES = 2 * 1024 * 1024

/** Client-side pre-check of a chosen file; returns an error message, or null when it looks uploadable. */
export function checkBrandingFile(file: File | null | undefined): string | null {
  if (!file || file.size === 0) return "Choose an image to upload."
  if (!ACCEPTED_TYPES.includes(file.type)) return "Use a PNG, JPEG or WebP image."
  if (file.size > MAX_BYTES) return "File too large (max 2 MB)."
  return null
}

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

  /** Runs an upload/reset for one slot and shows its result; `onSuccess` runs only when it worked. */
  const run = (
    param: string,
    fn: () => Promise<{ error: string } | { success: string } | undefined>,
    onSuccess?: () => void,
  ) =>
    start(async () => {
      const r = await fn()
      if (r && "error" in r) setMsg((m) => ({ ...m, [param]: { error: r.error } }))
      else {
        setMsg((m) => ({ ...m, [param]: { success: r?.success ?? "Updated." } }))
        setVer((v) => ({ ...v, [param]: (v[param] ?? 0) + 1 }))
        onSuccess?.()
      }
    })

  /**
   * Validates then uploads one slot's file. Uses onSubmit (not a form action):
   * React resets an action form after every submit, which would clear the
   * chosen file even when the server rejects it.
   */
  const submit = (param: string, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const input = form.elements.namedItem("file") as HTMLInputElement | null
    const error = checkBrandingFile(input?.files?.[0])
    if (error) {
      setMsg((m) => ({ ...m, [param]: { error } }))
      return
    }
    const fd = new FormData(form)
    run(param, () => uploadBranding(param, fd), () => form.reset())
  }

  /** Checks a newly picked file at once so a bad one is flagged before upload. */
  const onPick = (param: string, e: ChangeEvent<HTMLInputElement>) => {
    const error = e.target.files?.[0] ? checkBrandingFile(e.target.files[0]) : null
    setMsg((m) => ({ ...m, [param]: error ? { error } : {} }))
  }

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
                  onSubmit={(e) => submit(s.param, e)}
                >
                  <input
                    type="file"
                    name="file"
                    accept={ACCEPT}
                    required
                    aria-label={`Upload ${s.label} image`}
                    onChange={(e) => onPick(s.param, e)}
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
