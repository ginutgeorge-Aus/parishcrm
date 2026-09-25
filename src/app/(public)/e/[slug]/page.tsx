import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { EventHero } from "@/components/public-event/EventHero"
import { RegistrationForm } from "@/components/public-event/RegistrationForm"
import { WaitlistForm } from "@/components/public-event/WaitlistForm"
import { RegistrationClosedPanel } from "@/components/public-event/RegistrationClosedPanel"
import { issueFormToken } from "@/lib/formToken"
import { stripeConfigured } from "@/lib/stripe"
import { getCardFeeConfig } from "@/lib/cardFeeSettings"
import { isRegistrationClosed } from "@/lib/eventClose"
import { getChurchSettings } from "@/lib/churchSettings"

type Props = { params: Promise<{ slug: string }> }

export default async function PublicEventPage(props: Props) {
  const params = await props.params;
  const event = await prisma.event.findUnique({
    where: { slug: params.slug },
    include: {
      ticketTypes: {
        include: {
          // Sold count excludes CANCELLED — those seats are released.
          registrationItems: {
            where: { registration: { paymentStatus: { not: "CANCELLED" } } },
            select: { quantity: true },
          },
        },
      },
      images: { select: { kind: true } },
    },
  })

  // Unpublished renders the same 404 as an unknown slug — a distinct
  // "not yet available" page confirms draft slugs exist.
  if (!event || !event.isPublished) notFound()

  // Only the fields the public components render — never spread the full row,
  // which would leak eventId, createdAt and registrationItems[] (internal IDs +
  // live inventory) into the public RSC payload / HTML (AUDIT-051).
  const ticketTypes = event.ticketTypes.map(tt => ({
    id: tt.id,
    name: tt.name,
    capacity: tt.capacity,
    price: parseFloat(tt.price.toString()),
  }))

  const soldCounts: Record<number, number> = {}
  for (const tt of event.ticketTypes) {
    soldCounts[tt.id] = tt.registrationItems.reduce((s, i) => s + i.quantity, 0)
  }

  const allSoldOut = ticketTypes.every(
    tt => tt.capacity !== null && soldCounts[tt.id] >= tt.capacity
  )

  const closed = isRegistrationClosed(event)

  const customQuestions = (event.customQuestions as unknown as import("@/lib/eventQuestions").CustomQuestion[]) ?? []

  const organizers = (Array.isArray(event.organizers) ? event.organizers : []) as unknown as import("@/lib/eventOrganizers").Organizer[]

  const soldOutTypes = ticketTypes
    .filter(tt => tt.capacity !== null && soldCounts[tt.id] >= tt.capacity)
    .map(tt => ({ id: tt.id, name: tt.name }))

  const v = event.updatedAt ? `?v=${event.updatedAt.getTime()}` : ""
  const hasUploadedBanner = event.images.some((i) => i.kind === "BANNER")
  const hasPoster = event.images.some((i) => i.kind === "POSTER")
  const posterSrc = hasPoster ? `/api/events/${params.slug}/image/poster${v}` : null
  const bannerSrc = hasUploadedBanner
    ? `/api/events/${params.slug}/image/banner${v}`
    : event.imageUrl || null

  // Per-request bot-protection token. Date.now() is intentionally impure
  // here — this is a dynamic server component that must stamp each render.
  // eslint-disable-next-line react-hooks/purity
  const formToken = issueFormToken(Date.now())

  // Card-fee rate for the display-only surcharge preview — only read when the
  // event passes the fee (avoids a needless AppSetting query otherwise).
  const cardFee = event.passCardFee ? await getCardFeeConfig() : null
  const { email: churchEmail } = await getChurchSettings()

  return (
    <>
      {/* 57px = mobile top-bar height (EventHero sticky header) */}
      <div className="flex flex-col md:flex-row min-h-[calc(100vh-57px)]">
        <EventHero
          title={event.title}
          description={event.description}
          date={event.date}
          endDate={event.endDate}
          location={event.location}
          organizers={organizers}
          ticketTypes={ticketTypes}
          recursLabel={event.recursLabel}
          startTime={event.startTime}
          category={event.category}
          posterSrc={posterSrc}
          bannerSrc={bannerSrc}
        />
        {closed ? (
          <RegistrationClosedPanel title={event.title} organizers={organizers} />
        ) : ticketTypes.length === 0 ? (
          <RegistrationClosedPanel
            title={event.title}
            organizers={organizers}
            message="Registration isn't available for this event yet."
          />
        ) : (
          <RegistrationForm
            slug={params.slug}
            ticketTypes={ticketTypes}
            soldCounts={soldCounts}
            customQuestions={customQuestions}
            allSoldOut={allSoldOut}
            formToken={formToken}
            onlinePaymentEnabled={event.onlinePaymentEnabled}
            stripeConfigured={stripeConfigured()}
            passCardFee={event.passCardFee}
            cardFeePct={cardFee?.pct ?? 0}
            cardFeeFixedCents={cardFee?.fixedCents ?? 0}
            tieredPricingEnabled={event.tieredPricingEnabled}
            familyPricingTiers={
              Array.isArray(event.familyPricingTiers) &&
              event.familyPricingTiers.every((n) => typeof n === "number" && Number.isFinite(n))
                ? (event.familyPricingTiers as number[])
                : []
            }
            familyWaiverEnabled={event.familyWaiverEnabled}
            churchEmail={churchEmail}
          />
        )}
      </div>
      {!closed && soldOutTypes.length > 0 && (
        <div className="px-4 sm:px-6 py-4">
          <WaitlistForm slug={params.slug} soldOutTypes={soldOutTypes} allSoldOut={allSoldOut} formToken={formToken} />
        </div>
      )}
      <footer className="px-6 py-4 text-xs text-muted-foreground text-center">
        Personal information collected for event registration purposes only.
      </footer>
    </>
  )
}
