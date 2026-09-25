"use client"

import { useId, useRef, useState } from "react"

type Mode = "draw" | "type"

// Signature capture with two equivalent input paths so the control is operable
// by everyone (WCAG 2.1.1 / 4.1.2):
//   • "draw"  — canvas + pointer events (mouse/touch), unchanged behaviour.
//   • "type"  — a labelled text input; the typed full name is rendered onto the
//               same canvas and read back as a PNG data URL, so both paths emit
//               the identical `data:image/png` contract the server + PDF expect.
// The canvas carries role="img" + a state-describing aria-label and an
// aria-describedby hint (the deferred describedby from); an optional
// `describedById` lets the host form fold in its own field description too.
export function SignaturePad({
  onChange,
  describedById,
}: {
  onChange: (dataUrl: string) => void
  describedById?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const typeInputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<Mode>("draw")
  const [drawing, setDrawing] = useState(false)
  const [signed, setSigned] = useState(false)
  const [typed, setTyped] = useState("")

  const hintId = useId()
  const describedBy = [describedById, hintId].filter(Boolean).join(" ")

  const pos = (e: React.PointerEvent) => {
    const c = ref.current!
    const r = c.getBoundingClientRect()
    // Canvas is displayed at w-full (< its 480×140 backing store on phones), so
    // scale CSS-pixel pointer coords into the intrinsic drawing space or the
    // stroke drifts from the finger on narrow screens.
    const scaleX = c.width / r.width
    const scaleY = c.height / r.height
    return { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY }
  }
  const start = (e: React.PointerEvent) => {
    e.preventDefault()
    setDrawing(true)
    const ctx = ref.current!.getContext("2d")!
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.strokeStyle = "#0f172a"
    const { x, y } = pos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }
  const drawMove = (e: React.PointerEvent) => {
    if (!drawing) return
    const ctx = ref.current!.getContext("2d")!
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }
  const end = () => {
    if (!drawing) return
    setDrawing(false)
    setSigned(true)
    onChange(ref.current!.toDataURL("image/png"))
  }

  const wipeCanvas = () => {
    const c = ref.current
    if (!c) return
    c.getContext("2d")?.clearRect(0, 0, c.width, c.height)
  }

  // Render the typed name onto the canvas in a signature-style face, shrinking
  // the font until it fits, then emit it as a PNG data URL. Empty input clears.
  const renderTyped = (value: string) => {
    const c = ref.current
    const ctx = c?.getContext("2d")
    if (!c || !ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    if (!value.trim()) {
      setSigned(false)
      onChange("")
      return
    }
    ctx.fillStyle = "#0f172a"
    ctx.textBaseline = "middle"
    let size = 52
    ctx.font = `italic ${size}px "Segoe Script", "Brush Script MT", cursive`
    while (size > 16 && ctx.measureText(value).width > c.width - 24) {
      size -= 2
      ctx.font = `italic ${size}px "Segoe Script", "Brush Script MT", cursive`
    }
    ctx.fillText(value, 12, c.height / 2)
    setSigned(true)
    onChange(c.toDataURL("image/png"))
  }

  const switchMode = (next: Mode) => {
    if (next === mode) return
    setMode(next)
    setTyped("")
    setSigned(false)
    wipeCanvas()
    onChange("")
    // Move focus to the newly-relevant control so keyboard users aren't stranded.
    requestAnimationFrame(() => {
      if (next === "type") typeInputRef.current?.focus()
      else ref.current?.focus()
    })
  }

  const clear = () => {
    wipeCanvas()
    setTyped("")
    setSigned(false)
    onChange("")
    if (mode === "type") typeInputRef.current?.focus()
    else ref.current?.focus()
  }

  const canvasLabel =
    mode === "type"
      ? typed.trim()
        ? `Signature preview for the typed name "${typed.trim()}"`
        : "Signature preview — enter your name in the field below to sign"
      : signed
        ? "Signature drawing area — signed. Draw again to replace, or use Clear."
        : "Signature drawing area — draw your signature with a mouse or touch, or choose “Type your name” to sign with the keyboard."

  return (
    <div>
      {/* Method chooser — native radios are keyboard-operable and announce as a
          group. Signing works whichever method is chosen. */}
      <fieldset className="mb-2 border-0 p-0 m-0">
        <legend className="text-sm font-medium text-foreground mb-1">Signature method</legend>
        <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Signature method">
          <label className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              name="signature-mode"
              value="draw"
              checked={mode === "draw"}
              onChange={() => switchMode("draw")}
            />
            Draw
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              name="signature-mode"
              value="type"
              checked={mode === "type"}
              onChange={() => switchMode("type")}
            />
            Type your name
          </label>
        </div>
      </fieldset>

      <canvas
        ref={ref}
        width={480}
        height={140}
        // role=img + a state-describing label so AT users know what the canvas
        // holds; tabIndex only in draw mode so the keyboard path is the input.
        role="img"
        aria-label={canvasLabel}
        aria-describedby={describedBy}
        tabIndex={mode === "draw" ? 0 : -1}
        className="w-full max-w-[480px] touch-none rounded border border-input bg-white"
        onPointerDown={mode === "draw" ? start : undefined}
        onPointerMove={mode === "draw" ? drawMove : undefined}
        onPointerUp={mode === "draw" ? end : undefined}
        onPointerLeave={mode === "draw" ? end : undefined}
      />

      {mode === "type" && (
        <div className="mt-2">
          <label htmlFor={`${hintId}-name`} className="block text-sm font-medium text-foreground mb-1">
            Type your full name to sign
          </label>
          <input
            id={`${hintId}-name`}
            ref={typeInputRef}
            type="text"
            autoComplete="name"
            aria-describedby={describedBy}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value)
              renderTyped(e.target.value)
            }}
            className="w-full max-w-[480px] rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
        </div>
      )}

      <div className="mt-1 flex items-center gap-3 text-sm">
        <button type="button" onClick={clear} className="inline-flex min-h-11 items-center px-1 py-2.5 underline text-muted-foreground">
          Clear
        </button>
        <span id={hintId} className="text-muted-foreground">
          {mode === "type"
            ? "Your typed name becomes your signature."
            : "Draw your signature above, or choose “Type your name” to sign with the keyboard."}
        </span>
      </div>
    </div>
  )
}
