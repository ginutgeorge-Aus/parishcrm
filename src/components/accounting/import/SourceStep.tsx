"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { radioGroupKeyDown } from "./radioKeys"
import { IMPORT_SOURCES, type ImportSource } from "@/lib/importSources"

const BADGE: Record<ImportSource, string> = { anz: "PDF", ofx: "OFX", qif: "QIF" }

/** Step 1: pick the export format. Radio-group semantics so it's keyboard/screen-reader friendly. */
export function SourceStep({
  value,
  onChange,
  onContinue,
}: Readonly<{ value: ImportSource; onChange: (s: ImportSource) => void; onContinue: () => void }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where is your data from?</CardTitle>
        <CardDescription>Pick the file type your bank exported.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="radiogroup" aria-label="Import source" onKeyDown={radioGroupKeyDown} className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(IMPORT_SOURCES) as ImportSource[]).map((id) => {
            const s = IMPORT_SOURCES[id]
            const selected = value === id
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange(id)}
                className={cn(
                  "flex min-h-11 items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent",
                  selected && "border-2 border-primary bg-secondary",
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-[11px] font-bold text-secondary-foreground">
                  {BADGE[id]}
                </span>
                <span>
                  <span className="block text-sm font-semibold">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">{s.description}</span>
                </span>
              </button>
            )
          })}
          <button
            type="button"
            role="radio"
            aria-checked={false}
            tabIndex={-1}
            disabled
            className="flex min-h-11 items-start gap-3 rounded-lg border bg-card p-3 text-left opacity-60"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-[11px] font-bold">AI</span>
            <span>
              <span className="block text-sm font-semibold">
                AI import <span className="ml-1 rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] text-info">Coming soon</span>
              </span>
              <span className="block text-xs text-muted-foreground">Any statement, read by AI</span>
            </span>
          </button>
        </div>
        <div className="flex justify-end">
          <Button onClick={onContinue}>Continue</Button>
        </div>
      </CardContent>
    </Card>
  )
}
