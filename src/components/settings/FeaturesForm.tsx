"use client"

import { useMemo, useState, useTransition } from "react"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { useUnsavedGuard } from "./unsavedChanges"
import { SettingsCard } from "./ui/SettingsCard"
import { SettingsRow } from "./ui/SettingsRow"
import { SettingsSubgroup } from "./ui/SettingsSubgroup"
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
  useUnsavedGuard(JSON.stringify(state) !== JSON.stringify(start))

  /** Save the full on/off map; a transport failure shows a retry message. */
  const save = () => {
    setResult(null)
    startTransition(async () => {
      try {
        const res = await saveFeatures(state)
        startTransition(() => setResult(res ?? { success: "Features saved" }))
      } catch {
        startTransition(() => setResult({ error: "Could not save features. Please try again." }))
      }
    })
  }

  /** One feature's row: label, description, blocking reason / warning, switch. */
  const row = (def: FeatureDef) => {
    const blocker = blockedBy(def, effective)
    const id = `feature-${def.key}`
    const descId = `${id}-desc`
    const warn = def.publicWarning && startOn.has(def.key) && !effective.has(def.key) && !blocker
    return (
      <SettingsRow
        key={def.key}
        label={<span className={blocker ? "text-muted-foreground" : undefined}>{def.label}</span>}
        htmlFor={id}
        description={
          <span id={descId} className="block">
            <span className="block">{def.description}</span>
            {blocker && <span className="block">Needs {blocker}</span>}
            {warn && <span role="status" className="block text-warning">{def.publicWarning}</span>}
          </span>
        }
      >
        <Switch
          id={id}
          aria-describedby={descId}
          checked={effective.has(def.key)}
          disabled={pending || blocker !== null}
          onCheckedChange={(v) => setState((s) => ({ ...s, [def.key]: v }))}
        />
      </SettingsRow>
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
      <SettingsCard
        title="Features"
        description="Choose which parts of ParishCRM your church uses. Turning a feature off hides it and blocks it. Your data is kept, and switching it back on restores everything."
        footer={
          <Button type="button" onClick={save} disabled={pending} className="min-h-11 w-full sm:w-auto">
            Save
          </Button>
        }
      >
        {topLevel.flatMap((top) => {
          const children = FEATURES.filter((f) => f.parent === top.key)
          return [
            row(top),
            ...(children.length > 0
              ? [<SettingsSubgroup key={`${top.key}-children`} title={`${top.label} options`}>{children.map(row)}</SettingsSubgroup>]
              : []),
          ]
        })}
        <FormFeedback state={result} />
      </SettingsCard>
    </div>
  )
}
