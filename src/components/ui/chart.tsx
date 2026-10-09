"use client"

import * as React from "react"
import * as RechartsPrimitive from "recharts"

import { cn } from "@/lib/utils"
import { useNonce } from "@/components/NonceProvider"

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: "", dark: ".dark" } as const

const INITIAL_DIMENSION = { width: 320, height: 200 } as const

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode
    icon?: React.ComponentType
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
>

function ChartContainer({
  id,
  className,
  children,
  config,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"]
  initialDimension?: {
    width: number
    height: number
  }
}) {
  const uniqueId = React.useId()
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`

  return (
    <div
      data-slot="chart"
      data-chart={chartId}
      className={cn(
        "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
        className
      )}
      {...props}
    >
      <ChartStyle id={chartId} config={config} />
      <RechartsPrimitive.ResponsiveContainer
        initialDimension={initialDimension}
      >
        {children}
      </RechartsPrimitive.ResponsiveContainer>
    </div>
  )
}

// Values are interpolated into a raw <style> tag below — restrict to safe CSS
// color syntax (hex/rgb/hsl/var/named) so a future config sourced from DB/URL
// cannot inject CSS. Blocks ; { } : which any breakout needs, and
// url(...) which is not a color and could trigger network requests.
const SAFE_CSS_COLOR = /^(?!.*url\s*\()[#a-zA-Z0-9(),.%\s/-]+$/i
const SAFE_CSS_KEY = /^[a-zA-Z0-9_-]+$/

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  // Production CSP nonces style-src; without the nonce the browser drops
  // this <style> and chart colours disappear. undefined in dev (unsafe-inline).
  const nonce = useNonce()
  const colorConfig = Object.entries(config).filter(
    ([, config]) => config.theme ?? config.color
  )

  // The id is interpolated into the selector unquoted — same injection
  // surface as the colors, so it gets the same guard.
  if (!colorConfig.length || !SAFE_CSS_KEY.test(id)) {
    return null
  }

  return (
    <style
      nonce={nonce}
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color =
      itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ??
      itemConfig.color
    return color && SAFE_CSS_COLOR.test(color) && SAFE_CSS_KEY.test(key)
      ? `  --color-${key}: ${color};`
      : null
  })
  .join("\n")}
}
`
          )
          .join("\n"),
      }}
    />
  )
}

export { ChartContainer }
