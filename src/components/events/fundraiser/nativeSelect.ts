/**
 * Shared classes for the fundraiser native `<select>`s: touch-sized on phones and coarse pointers,
 * compact from `md`. Width is left to the caller (`w-full` in forms, natural width in inline rows).
 */
export const NATIVE_SELECT_CLASS =
  "h-11 md:h-8 any-pointer-coarse:h-11 rounded-lg border border-input bg-background px-2.5 text-base md:text-sm"
