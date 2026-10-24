/** @jest-environment node */
import { _resetFeaturesWarn, parseOverridesWarn } from "@/lib/featuresWarn"

let warn: jest.SpyInstance
beforeEach(() => {
  _resetFeaturesWarn()
  warn = jest.spyOn(console, "warn").mockImplementation(() => undefined)
})
afterEach(() => warn.mockRestore())

describe("parseOverridesWarn", () => {
  it("returns the overrides and never warns on valid or empty values", () => {
    for (const raw of [null, "", "{}", "{ }"]) expect(parseOverridesWarn(raw)).toEqual({})
    expect(parseOverridesWarn('{"events":false}')).toEqual({ events: false })
    expect(warn).not.toHaveBeenCalled()
  })

  it("warns once per distinct unreadable value, however often it is read", () => {
    for (let i = 0; i < 3; i++) expect(parseOverridesWarn("not json")).toEqual({})
    expect(warn).toHaveBeenCalledTimes(1)
    parseOverridesWarn("{bad")
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("warns again when the same bad value returns after a good one", () => {
    parseOverridesWarn("not json")
    parseOverridesWarn('{"events":false}')
    parseOverridesWarn("not json")
    expect(warn).toHaveBeenCalledTimes(2)
  })
})
