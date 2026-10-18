"use client"

import { useMemo, useState, useTransition } from "react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { saveFeatures } from "@/lib/actions/features"
import {
  FEATURES, featureDef, resolveFeatures, type FeatureDef, type FeatureKey, type FeatureOverrides,
} from "@/lib/features"

type Props = Readonly<{ initial: FeatureOverrides; welcome?: boolean }>
type State = Record<FeatureKey, boolean>

/** Full on/off map: stored override, else the registry default. */
function initialState(initial: FeatureOverrides): State {
  return Object.fromEntries(FEATURES.map((f) => [f.key, initial[f.key] ?? f.defaultOn])) as State
}

/** Label of the first parent/requirement that is off, or null when none blocks `def`. */
function blockedBy(def: FeatureDef, effective: ReadonlySet<FeatureKey>): string | null {
  const deps = [...(def.parent ? [def.parent] : []), ...(def.requires ?? [])]
  const off = deps.find((k) => !effective.has(k))
  return off ? featureDef(off).label : null
}

/**
 * Settings → Features checklist. Children sit indented under their parent and
 * are disabled while a parent/requirement is off (their own choice is kept, so
 * switching the parent back on restores them). One Save writes everything.
 */
export function FeaturesForm({ initial, welcome = false }: Props) {
  const start = useMemo(() => initialState(initial), [initial])
  const startOn = useMemo(() => resolveFeatures(start), [start])
  const [state, setState] = useState<State>(start)
  const [result, setResult] = useState<{ error?: string; success?: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const effective = useMemo(() => resolveFeatures(state), [state])

  const save = () => {
    setResult(null)
    startTransition(async () => {
      const res = await saveFeatures(state)
      setResult(res ?? { success: "Features saved" })
    })
  }

  const row = (def: FeatureDef) => {
    const blocker = blockedBy(def, effective)
    const id = `feature-${def.key}`
    const warn = def.publicWarning && startOn.has(def.key) && !effective.has(def.key) && !blocker
    return (
      <li key={def.key} className={def.parent ? "pl-6" : undefined}>
        <div className="flex min-h-11 items-start justify-between gap-4 py-2">
          <div className="min-w-0">
            <Label htmlFor={id} className={blocker ? "text-muted-foreground" : undefined}>
              {def.label}
            </Label>
            <p className="text-sm text-muted-foreground">{def.description}</p>
            {blocker && <p className="text-sm text-muted-foreground">Needs {blocker}</p>}
            {warn && <p className="text-sm text-warning">{def.publicWarning}</p>}
          </div>
          <Switch
            id={id}
            className="mt-1"
            checked={effective.has(def.key)}
            disabled={pending || blocker !== null}
            onCheckedChange={(v) => setState((s) => ({ ...s, [def.key]: v }))}
          />
        </div>
      </li>
    )
  }

  const topLevel = FEATURES.filter((f) => !f.parent)
  return (
    <div className="space-y-6">
      {welcome && (
        <p className="rounded-md border border-border bg-muted p-4 text-sm">
          Pick what your church needs. You can change this any time in Settings → Features.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Turning a feature off hides it and blocks it. Your data is kept, and switching it back on restores everything.
      </p>
      <ul className="divide-y divide-border">
        {topLevel.map((top) => [
          row(top),
          ...FEATURES.filter((f) => f.parent === top.key).map(row),
        ])}
      </ul>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="button" onClick={save} disabled={pending} className="min-h-11 w-full sm:w-auto">
          Save
        </Button>
        <FormFeedback state={result} />
      </div>
    </div>
  )
}
