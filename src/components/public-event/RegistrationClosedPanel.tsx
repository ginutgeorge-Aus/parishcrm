import type { Organizer } from "@/lib/eventOrganizers"

type Props = { title: string; organizers: Organizer[]; message?: string }

// Shown on the public event page when registration is closed (manual flag,
// deadline passed, or no ticket types configured). Organiser render mirrors
// EventHero: name + tel: link when a phone is present, name-only otherwise.
// Empty organisers → church-office fallback.
export function RegistrationClosedPanel({ title, organizers, message }: Props) {
  const hasOrganizers = organizers.length > 0
  return (
    <div className="mx-auto max-w-md px-6 py-10 text-center">
      <p className="text-lg font-semibold text-foreground">
        {message ?? `Registration for ${title} is closed.`}
      </p>
      {hasOrganizers ? (
        <div className="mt-4 text-sm">
          <p className="text-muted-foreground">Please contact:</p>
          <ul className="mt-2 space-y-1">
            {organizers.map((o, i) => (
              <li key={i}>
                {o.name}
                {o.phone && (
                  <>
                    {" "}
                    <a href={`tel:${o.phone.replace(/\s+/g, "")}`} className="text-primary underline">
                      {o.phone}
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Please contact the church office.
        </p>
      )}
    </div>
  )
}
