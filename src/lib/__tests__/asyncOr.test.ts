import { fetchIf } from "@/lib/asyncOr"

test("condition true: calls fetch and returns its resolved value", async () => {
  const fetch = jest.fn().mockResolvedValue(42)
  await expect(fetchIf(true, fetch, 0)).resolves.toBe(42)
  expect(fetch).toHaveBeenCalledTimes(1)
})

test("condition false: resolves with fallback without calling fetch", async () => {
  const fetch = jest.fn().mockResolvedValue(42)
  await expect(fetchIf(false, fetch, 0)).resolves.toBe(0)
  expect(fetch).not.toHaveBeenCalled()
})

test("condition is a falsy non-boolean (null): treated as false", async () => {
  const fetch = jest.fn().mockResolvedValue("x")
  await expect(fetchIf(null, fetch, "fallback")).resolves.toBe("fallback")
  expect(fetch).not.toHaveBeenCalled()
})
