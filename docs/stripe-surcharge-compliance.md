# Card Surcharge — Compliance Basis (AU)

Covers the optional card surcharge applied when an event has `Event.passCardFee`
enabled (`src/lib/cardFee.ts::grossUpTotal`, rate from `src/lib/cardFeeSettings.ts`).
Filed for.

## Legal test

Under the RBA surcharging standard and the ACCC's excessive-surcharge rules
(Competition and Consumer Act s55B), a card surcharge is lawful only if it does
**not exceed the merchant's cost of acceptance** for that card type — the fees the
payment provider actually charges to accept the card, expressed as a percentage of
the transaction (plus any per-transaction fixed fee).

## Our cost of acceptance

Payments run through **Stripe Checkout**. Stripe's published Australian pricing:

| Card | Stripe fee (cost of acceptance) |
|------|---------------------------------|
| Domestic (AU-issued) card | **1.7% + A$0.30** |
| International card | 3.5% + A$0.30 |
| + currency conversion (if any) | +2% |

The app's **default surcharge is `1.7% + $0.30`** (`cardFeePercent` / `cardFeeFixed`
AppSettings, defaults in `cardFeeSettings.ts`). This is set **equal to the domestic
cost of acceptance** and **below** the international one, so:

- On a domestic card the surcharge exactly recovers Stripe's fee — never exceeds it. **Compliant.**
- On an international card the true cost is higher (3.5%), so the 1.7% surcharge
  **under-recovers**; the church absorbs the difference. Surcharge is still ≤ cost
  of acceptance. **Compliant.**

The gross-up math (`grossUpTotal`) solves for the amount that, after Stripe deducts
its blended fee, nets the exact ticket price — it recovers the fee, it does not add a
margin. `Registration.totalAmount` stays the NET ticket price; the surcharge is
checkout-only and snapshotted on `CheckoutSession.surchargeCents`.

## Keeping it compliant

- **Do not raise `cardFeePercent` above Stripe's domestic rate** (currently 1.7%).
  If Stripe changes AU pricing, update the AppSetting to match — never exceed it.
- The bank-transfer payment path is **never** surcharged.
- Surcharge is opt-in per event (`passCardFee`), off by default.

## GST treatment — CONFIRM WITH THE CHURCH'S ACCOUNTANT

A card surcharge is additional consideration for the underlying supply, so it takes
the **same GST treatment as the ticket it is charged on**:

- If an event's tickets are a **taxable supply** (GST-registered entity, taxable
  event), the surcharge carries GST in the same 1/11th proportion, and the tax
  invoice/receipt total already includes it.
- If the ticket is **GST-free or input-taxed**, or the church is **not GST-registered**,
  no GST applies to the surcharge either.

Most church event income is likely outside the GST net (non-registered / religious),
in which case no GST arises on the surcharge. **This must be confirmed against the
church's actual GST registration status and the nature of each event before relying on
it** — this doc records the basis, not tax advice. If GST does apply, ensure the
DGR/receipt output states the GST-inclusive total.
