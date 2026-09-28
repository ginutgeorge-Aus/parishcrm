// Run `fetch()` when `condition` is truthy, otherwise resolve immediately with
// `fallback` — the common "only query when we have an anchor" pattern used by
// the reconciliation pages' Promise.all batches (e.g. skip the cleared/
// uncleared aggregates when there's no opening balance yet). Keeping this as
// a plain function call (rather than an inline ternary) at each call site
// keeps those pages' cognitive complexity down.
export function fetchIf<T>(condition: unknown, fetch: () => Promise<T>, fallback: T): Promise<T> {
  return condition ? fetch() : Promise.resolve(fallback)
}
