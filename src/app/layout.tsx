import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { Public_Sans } from "next/font/google"
import { headers } from "next/headers"
import Script from "next/script"
import "./globals.css"
import { Providers } from "@/components/Providers"
import { NonceProvider } from "@/components/NonceProvider"
import { getChurchSettings } from "@/lib/churchSettings"
import { PRIMARY_HEX, hexToHslTriple, parseHex } from "@/lib/theme/palette"
import { APP_LOCALE, publicAppConfig } from "@/lib/appConfig"

// Body / UI / data face — Public Sans is built for institutional legibility
// (US government design system), ideal for non-technical trustees reading money.
const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
})
// Retained for codes / IDs only (member numbers, refs).
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-mono",
  weight: "100 900",
})

export async function generateMetadata(): Promise<Metadata> {
  const { name } = await getChurchSettings()
  return {
    title: `${name} CRM`,
    description: `${name} Portal`,
    icons: { icon: "/api/branding/icon", apple: "/api/branding/icon" },
    // Launch full-screen (no Safari chrome) when added to the iOS home screen.
    appleWebApp: {
      capable: true,
      title: `${name} CRM`,
      statusBarStyle: "default",
    },
  }
}

// Render at device width on phones instead of a zoomed-out desktop layout;
// theme-color tints the mobile browser / installed-app status bar (primary).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: PRIMARY_HEX,
}

// Per-deploy theme override: when THEME_PRIMARY/THEME_ACCENT env is set, emit a
// :root block that wins over globals.css's neutral defaults (later in the DOM,
// equal specificity). A deploy restores its brand colours with zero source edits
// (OSS migration Phase 2). No env → neutral monochrome-slate defaults stand.
// --gold-foreground stays fixed dark, so it pairs with both gold and slate-200.
function themeOverrideCss(): string | null {
  // parseHex → null for absent OR malformed, so a typo'd override is dropped and
  // the neutral globals.css defaults stand (consistent with the palette's hex
  // exports), rather than emitting a broken dark-on-dark token.
  const primary = parseHex(process.env.THEME_PRIMARY)
  const accent = parseHex(process.env.THEME_ACCENT)
  if (!primary && !accent) return null
  const rules: string[] = []
  if (primary) rules.push(`--primary:${hexToHslTriple(primary)};`)
  if (accent) {
    const a = hexToHslTriple(accent)
    rules.push(`--gold:${a};`, `--ring:${a};`)
  }
  return `:root{${rules.join("")}}`
}

// The per-request CSP nonce (set in middleware) can only be injected into
// dynamically-rendered pages. Force dynamic rendering app-wide so statically
// prerendered pages (login, forgot-password, privacy) don't ship nonce-less
// scripts that the strict CSP would block.
export const dynamic = "force-dynamic"

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Thread the per-request nonce to client components that render inline
  // <style> tags (e.g. components/ui/chart.tsx), now that style-src is
  // nonce-based instead of 'unsafe-inline'.
  const nonce = (await headers()).get("x-nonce") ?? undefined
  const themeCss = themeOverrideCss()
  return (
    <html lang={APP_LOCALE}>
      <body className={`${publicSans.variable} ${geistMono.variable} font-sans antialiased`}>
        {/* Runtime regional/Turnstile config for client code (src/lib/appConfig.ts).
            beforeInteractive runs before any app chunk evaluates, so appConfig's
            module-level constants see it. `<` escaped so a value can't close the tag. */}
        <Script id="app-config" strategy="beforeInteractive" nonce={nonce}>
          {`window.__APP_CONFIG__=${JSON.stringify(publicAppConfig()).replace(/</g, "\\u003c")}`}
        </Script>
        {themeCss && <style nonce={nonce}>{themeCss}</style>}
        <NonceProvider nonce={nonce}>
          <Providers>{children}</Providers>
        </NonceProvider>
      </body>
    </html>
  )
}
