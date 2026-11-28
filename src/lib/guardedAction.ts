import { z } from "zod"
import type { Session } from "next-auth"
import { auth } from "@/auth"
import type { UserRole } from "@/lib/generated/prisma/enums"
import { assertNotDemo } from "@/lib/demoMode"
import { assertFeature, featureGuard } from "@/lib/featureFlags"
import type { FeatureKey } from "@/lib/features"
import { isValidPgId } from "@/lib/validation"
import { logger } from "@/lib/logger"

// One entry point for every exported Server Action (audit idea 83, #3333/#3334).
// TypeScript types vanish at runtime: any client can call an exported action
// with arguments of any shape (an object where a string was typed is a Prisma
// filter). guardedAction runs, in a fixed order, before the action's own code:
//   demo block (opt-in) → auth() → role check → feature flag → zod parse of
//   every argument
// and hands the handler only the parsed arguments. The `crm/server-action-wrapper`
// lint rule (eslint-rules/serverActionWrapper.cjs) makes every new exported
// action use it.

/** A one-argument roleGuard helper (`isAdmin`, `canEdit`, `canAccessAccounting`, ...). */
export type RoleCheck = (role: UserRole | undefined) => boolean

/** The default refusal shape, compatible with `ActionResult` / `ActionResultWithSuccess`. */
export type ActionError = { error: string }

/** Message for a refused role (same text the hand-written guards return). */
const UNAUTHORIZED = "Unauthorized"

type ArgsSchema = z.ZodTuple

interface BaseSpec<A extends ArgsSchema> {
  /**
   * `isAdmin`, `canEdit`, ...: the caller must be signed in and pass it.
   * `"public"`: no sign-in (anonymous actions); the handler gets `session: null`
   * and must do its own throttling.
   */
  guard: RoleCheck | "public"
  /** zod tuple, one entry per action parameter, in order. */
  args: A
  /** Feature flag the action belongs to; checked after the role, never before. */
  feature?: FeatureKey
  /** Refuse in the live demo (`assertNotDemo`) before anything else. */
  blockInDemo?: boolean
}

/** Spec for an action whose result can carry `{ error }` (form and mutation actions). */
export type GuardedSpec<A extends ArgsSchema> = BaseSpec<A>

/**
 * Spec for a reader / validator whose result has no `{ error }` shape. `denied`
 * is returned for a refused role, a demo block or bad arguments; a disabled
 * feature throws (`assertFeature`), as hand-written readers do today.
 */
export type GuardedReaderSpec<A extends ArgsSchema, R> = BaseSpec<A> & { denied: R }

/** What the handler receives besides its parsed arguments. */
export type ActionContext = {
  /** The signed-in session; `null` only for `guard: "public"`. */
  session: Session | null
}

/** Context for a role-guarded action: the session is always present. */
export type SignedInContext = { session: Session }

type Handler<A extends ArgsSchema, C, R> = (ctx: C, args: z.output<A>) => Promise<R>

/**
 * Run one Server Action behind its guard and argument check. Call it as the
 * only statement of an exported action, passing the raw parameters in order:
 *
 * ```ts
 * export async function deleteFund(id: number): Promise<ActionResult> {
 *   return guardedAction({ guard: isAdmin, feature: "accounting", args: z.tuple([pgIdArg]) }, [id],
 *     async ({ session }, [id]) => { ... })
 * }
 * ```
 *
 * Order: demo block → auth + role → feature → argument parse → handler. A
 * refusal returns `{ error }` (or `denied` for readers) and runs no handler code.
 * @param spec guard, argument schema and optional feature / demo block / denied value
 * @param input the action's raw parameters, in declaration order
 * @param handler the action body; gets the session and the parsed arguments
 * @returns the handler's result, or the refusal
 */
export async function guardedAction<A extends ArgsSchema, R>(
  spec: GuardedReaderSpec<A, R> & { guard: RoleCheck },
  input: readonly unknown[],
  handler: Handler<A, SignedInContext, R>,
): Promise<R>
export async function guardedAction<A extends ArgsSchema, R>(
  spec: GuardedReaderSpec<A, R> & { guard: "public" },
  input: readonly unknown[],
  handler: Handler<A, ActionContext, R>,
): Promise<R>
export async function guardedAction<A extends ArgsSchema, R>(
  spec: GuardedSpec<A> & { guard: RoleCheck },
  input: readonly unknown[],
  handler: Handler<A, SignedInContext, R>,
): Promise<R | ActionError>
export async function guardedAction<A extends ArgsSchema, R>(
  spec: GuardedSpec<A> & { guard: "public" },
  input: readonly unknown[],
  handler: Handler<A, ActionContext, R>,
): Promise<R | ActionError>
export async function guardedAction<A extends ArgsSchema, R>(
  spec: GuardedSpec<A> & { denied?: R },
  input: readonly unknown[],
  handler: Handler<A, never, R>,
): Promise<R | ActionError> {
  const reader = "denied" in spec
  const refuse = (error: string): R | ActionError => (reader ? (spec.denied as R) : { error })

  if (spec.blockInDemo) {
    const demo = assertNotDemo()
    if (demo) return refuse(demo.error)
  }

  let session: Session | null = null
  if (spec.guard !== "public") {
    session = await auth()
    if (!session?.user || !spec.guard(session.user.role)) return refuse(UNAUTHORIZED)
  }

  if (spec.feature) {
    if (reader) {
      await assertFeature(spec.feature)
    } else {
      const off = await featureGuard(spec.feature)
      if (off) return off
    }
  }

  const parsed = spec.args.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    // Readers return `denied`, which looks like "no permission"; log so a mis-declared tuple is findable.
    // Paths only, never the rejected values (they may be PII).
    if (reader) logger.warn("guardedAction: reader arguments rejected", { paths: parsed.error.issues.map((i) => i.path.join(".")) })
    // An empty path is a tuple-level issue (arity); zod's own text is internal, so use a fixed message.
    return refuse(issue && issue.path.length > 0 && issue.message ? issue.message : "Invalid input")
  }

  return (handler as Handler<A, ActionContext, R>)({ session }, parsed.data)
}

// ── Argument schemas shared by many actions ──────────────────────────────────

/** A Postgres int4 row id (`isValidPgId`); refused with "Invalid ID". */
export const pgIdArg = z.custom<number>((v) => typeof v === "number" && isValidPgId(v), { error: "Invalid ID" })

/** A `FormData` body (the last parameter of a form action). */
export const formDataArg = z.instanceof(FormData, { error: "Invalid form data" })

/**
 * The `useActionState` previous-state parameter. Never read by actions, so
 * any value is accepted; it is listed only to keep the tuple positional.
 */
export const prevStateArg = z.unknown()
