// Pure, dependency-free so it is unit-testable and safe to import from the
// public page, the register pipeline, and the waitlist route without pulling
// prisma/next into a plain jest test (see reference-jest-nextserver-route-trap).
export function isRegistrationClosed(
  event: { registrationClosed: boolean; registrationDeadline: Date | null },
  now: Date = new Date(),
): boolean {
  if (event.registrationClosed) return true
  if (event.registrationDeadline && now > event.registrationDeadline) return true
  return false
}
