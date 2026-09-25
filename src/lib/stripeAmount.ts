import { APP_CURRENCY } from "@/lib/appConfig"

// App money math is integer hundredths ("cents", see toCents). Stripe wants the
// currency's own minor unit, so convert only at the Stripe boundary.
// Lists from https://docs.stripe.com/currencies#special-cases. ISK/UGX are
// passed as two-decimal amounts that must end in 00 (whole units). HUF/TWD are
// two-decimal in the API for card charges, so they fall through unchanged.
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "VND", "VUV", "XAF", "XOF", "XPF"])
const WHOLE_UNIT_TWO_DECIMAL = new Set(["ISK", "UGX"])
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"])

const isWholeUnit = (currency: string) => ZERO_DECIMAL.has(currency) || WHOLE_UNIT_TWO_DECIMAL.has(currency)

/** A price the currency can't represent (e.g. ¥1000.50) — checkout returns a handled error. */
export class CurrencyPrecisionError extends Error {
  constructor(cents: number, readonly currency: string) {
    super(`Amount ${cents / 100} has a fractional part, which ${currency} (whole units only) cannot charge`)
  }
}

export const STRIPE_CURRENCY = APP_CURRENCY.toLowerCase()

export function toStripeAmount(cents: number, currency: string = APP_CURRENCY): number {
  if (THREE_DECIMAL.has(currency)) return cents * 10
  if (isWholeUnit(currency) && cents % 100 !== 0) throw new CurrencyPrecisionError(cents, currency)
  return ZERO_DECIMAL.has(currency) ? cents / 100 : cents
}

/** Round computed cents (e.g. a card-fee gross-up) to what the currency can charge. */
export function roundCentsForCurrency(cents: number, currency: string = APP_CURRENCY): number {
  return isWholeUnit(currency) ? Math.round(cents / 100) * 100 : cents
}
