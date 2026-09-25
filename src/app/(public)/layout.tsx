import Image from "next/image"
import { SiteFooter } from "@/components/SiteFooter"
import { PublicFeedbackDialog } from "@/components/public/PublicFeedbackDialog"
import { getChurchSettings } from "@/lib/churchSettings"

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const { name: churchName } = await getChurchSettings()
  return (
    <div className="min-h-[100dvh] bg-muted overflow-x-clip w-full max-w-full">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow"
      >
        Skip to main content
      </a>
      <header className="bg-card border-b border-border px-4 sm:px-6 py-3 flex items-center gap-3">
        <span className="flex items-center rounded bg-background p-0.5">
          <Image src="/api/branding/crest-header" alt="" width={56} height={64} className="h-8 w-auto" unoptimized />
        </span>
        <span className="font-bold text-foreground">{churchName}</span>
      </header>
      <main id="main-content">{children}</main>
      <div className="border-t bg-card">
        <div className="px-4 sm:px-6 pt-3 flex justify-center">
          <PublicFeedbackDialog />
        </div>
        <SiteFooter churchName={churchName} className="px-4 sm:px-6 py-3" />
      </div>
    </div>
  )
}
