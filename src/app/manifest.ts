import type { MetadataRoute } from "next"
import { getChurchSettings } from "@/lib/churchSettings"
import { PRIMARY_HEX } from "@/lib/theme/palette"

// Rendered per-request, not prerendered at build: manifest reads the church name
// from getChurchSettings() (DB), and the build env has no DATABASE_URL. Matches
// the app-wide force-dynamic on the root layout ( fails loudly without a DB).
export const dynamic = "force-dynamic"

// Web app manifest — enables "Add to Home Screen" as a standalone app on
// Android/desktop PWAs. iOS uses the apple-touch-icon + appleWebApp metadata
// instead, but a valid manifest is still served for completeness.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { name } = await getChurchSettings()
  return {
    name: `${name} CRM`,
    short_name: `${name} CRM`,
    description: `${name} Portal`,
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: PRIMARY_HEX,
    icons: [
      { src: "/api/branding/icon", sizes: "180x180", type: "image/png" },
      { src: "/api/branding/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      // Maskable variant so Android's adaptive-icon system doesn't crop the icon
      // into a circle with a white background (purpose only accepts one token).
      { src: "/api/branding/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
