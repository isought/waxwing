I now have a complete picture. Here is the full analysis.

---

## Source of Truth: What `TotalActivity.execute` Currently Does

`TotalActivity.java`, lines 50–84, runs at pricing workflow position ORDER=8000. Its logic has two independent parts:

**Part 1 – order-level running total (lines 55–62):**
```java
total = ZERO
total += order.getSubTotal()
total -= order.getOrderAdjustmentsValue()
total += order.getTotalShipping()         // set earlier by FulfillmentGroupPricingActivity
if (order.getTotalTax() != null)
    total += order.getTotalTax()          // set moments earlier by setTaxSums(order)
```

**Part 2 – per-FulfillmentGroup loop (lines 64–77):**
```java
fees = ZERO
for each FulfillmentGroup fg:
    fgTotal = fg.merchandiseTotal + fg.shippingPrice + fg.totalTax
    for each FulfillmentGroupFee fee:
        fgTotal += fee.getAmount()        // fee included in FG total
        fees    += fee.getAmount()        // fee accumulated for order total
    fg.setTotal(fgTotal)                  // ← ALWAYS includes fee; unchanged by proposal
```

**Part 3 – finalize order total (lines 79–80):**
```java
total = total.add(fees);     // ← THE LINE BEING REMOVED
order.setTotal(total);       // persists to BLC_ORDER.ORDER_TOTAL
```

**Precondition for any effect**: Fees only exist when `ConsolidateFulfillmentFeesActivity` (ORDER=2000) has run first and at least one `Sku` on the order carries a `SkuFee` of type `FULFILLMENT`. If no such fees exist, `fees` is zero and the removal is a no-op.

---

## What the Change Actually Does

Removing `total = total.add(fees)` produces these simultaneous effects:

| Field | With current code | After removal |
|---|---|---|
| `order.getTotal()` / `BLC_ORDER.ORDER_TOTAL` | includes fees | **excludes fees** |
| `FulfillmentGroup.getTotal()` | includes fees | **still includes fees** |
| `order.getTotalTax()` | includes tax on fees | **still includes tax on fees** |
| `FulfillmentGroupFee.getAmount()` | fee objects exist | fee objects still exist |

The immediate structural result is an **internal inconsistency**: `FulfillmentGroup.setTotal(fgTotal)` at line 76 is unaffected because it draws from the local `fgTotal` variable, not from `total`. After the change, Σ(`FulfillmentGroup.getTotal()`) across all FGs will exceed `order.getTotal()` by exactly Σ(`FulfillmentGroupFee.getAmount()`). Additionally, `order.getTotalTax()` will still include taxes on fees, yet `order.getTotal()` will not include the pre-tax fee amounts — so the order total will contain tax-on-fees without the base fee itself.

---

## Downstream Effects on `order.getTotal()`

Every downstream consumer reads `order.getTotal()` from the field set at line 80. There is no later activity in the pricing or checkout workflow that re-adds fees. All effects below are concrete behavioral changes when fees > 0.

### 1. `AdjustOrderPaymentsActivity` — payment adjustment (ORDER=9000, runs next in pricing workflow)
**Source**: `AdjustOrderPaymentsActivity.java:95`
```java
Money difference = order.getTotal().subtract(appliedPaymentsWithoutThirdPartyOrCC);
unconfirmedThirdPartyOrCreditCard.setAmount(difference);
```
**Active when**: There is an active, unconfirmed `THIRD_PARTY_ACCOUNT` or `CREDIT_CARD` payment (e.g. PayPal Express Checkout).

**Effect**: The payment amount sent to the gateway will be under by Σ fees.

**Concrete example** (from class Javadoc): Order total $35 (includes $3 fee), gift card $10 applied.
- Before: PayPal amount = $35 − $10 = **$25**.
- After: PayPal amount = $32 − $10 = **$22**. The $3 fee goes uncharged.

This is a real money consequence, not merely display.

### 2. `ValidateAndConfirmPaymentActivity` — checkout payment sufficiency check
**Source**: `ValidateAndConfirmPaymentActivity.java:256–259`
```java
if (paymentSum.lessThan(order.getTotal())) {
    throw new IllegalArgumentException("There are not enough payments...");
}
```
**Active when**: Checkout is performed on any order.

**Effect**: The threshold against which authorized payment amounts are compared is reduced by Σ fees. Checkouts that should fail (because the customer was charged for an amount that doesn't include fees) may now pass.

**Before/after**: Pre-auth of $32 on an order with `order.getTotal()` previously = $35:
- Before: $32 < $35 → exception thrown, checkout blocked.
- After: $32 < $32 → false, checkout proceeds; fee never collected.

### 3. `OrderImpl.getTotalAfterAppliedPayments()` — cascades to payment controllers and gateway DTOs
**Source**: `OrderImpl.java:326`
```java
Money myTotal = getTotal(); // now excludes fees
return myTotal.subtract(totalPayments);
```
This computed value flows to:

- **`BroadleafCheckoutController.java:213,218`**: Passthrough payment amount set to `cart.getTotalAfterAppliedPayments()` — undercharged by fee amount.
- **`BroadleafPaymentInfoController.java:99`**: Payment created from saved customer payment set to `cart.getTotalAfterAppliedPayments()` — undercharged.
- **`OrderToPaymentRequestDTOServiceImpl.java:161–162`** (`populateTotals()`): `transactionTotal` field in the `PaymentRequestDTO` sent to any payment gateway will exclude fees.
- **`CheckoutFormVariableExpression.java:70`**: `getTotalAfterAppliedPayments()` is used to determine whether all payments cover the order total. If the total is now lower, the UI might incorrectly declare the cart "fully paid" before fees are covered.

### 4. Google Analytics reporting
**Source**: `GoogleUniversalAnalyticsProcessor.java:251` (deprecated but still registered), `GoogleAnalytics4Processor.java:198`
```java
sb.append(",'revenue': '" + order.getTotal() + "'");  // UA
sb.append(",value: " + order.getTotal());              // GA4
```
**Effect**: Revenue/purchase value reported to Google on order confirmation pages will be understated by fees. This is a reporting consequence, not a payment consequence, but corrupts revenue analytics for SKU-fee-bearing orders.

### 5. `OrderServiceImpl` debug logging
**Source**: `OrderServiceImpl.java:1205`
```java
.addRow("Total", order.getTotal())
```
Informational only; the displayed total at DEBUG level will not include fees.

---

## Tests That Will Break

**`TotalActivitySpec.groovy:128`** (`TotalActivity.java` unit test):
```groovy
then: "... should add up to be 13.09"
context.seedData.total.amount == 13.09   // FAILS — becomes 12.59
```
Setup: subTotal=$10, shipping=$1.99, fee=$0.50, taxes=$0.60. Currently: 10 + 1.99 + 0.60 + 0.50 = **13.09**. After: 10 + 1.99 + 0.60 = **12.59**.

**`TotalActivitySpec.groovy:141`** (taxOverride=true variant):
```groovy
then: "... should add up to be 12.49"
context.seedData.total.amount == 12.49   // FAILS — becomes 11.99
```
With taxOverride: 10 + 1.99 + 0 + 0.50 = **12.49**. After: 10 + 1.99 = **11.99**.

**`PricingTest.java:206`** (integration test):
```java
assert (order.getTotal().equals(
    order.getSubTotal()
    .add(order.getTotalTax())
    .add(order.getTotalShipping())
    .add(fulfillmentGroupFeeTotal)         // ← fee explicitly included in assertion
    .subtract(order.getOrderAdjustmentsValue())));
// FAILS — order.getTotal() no longer includes fulfillmentGroupFeeTotal
```

**`OfferServiceTest.java:252`**: Asserts `order.getTotal().equals(new Money("50.50"))`, computed as $40 + $2 + $8.50 = $50.50 with no fees in that test. **Not affected.**

**`CheckoutTest.java:129`**: Asserts `order.getTotal().greaterThan(order.getSubTotal())`. Whether this holds depends on whether fees were the only thing making total > subTotal in that test setup. Since the test includes shipping/taxes, likely unaffected, but I could not verify the test's full setup exhaustively from this source review.

---

## Documented Contract Conflict

`Order.java:132–133` (the Javadoc for `setTotal`):
> "This includes the prices of all of the OrderItems as well as any taxes, **fees**, shipping and adjustments for all 3."

The removal directly contradicts the documented contract of the method.

The Javadoc for `getTotal()` at line 56 of `Order.java` says only "equivalent of `getSubTotal() - getOrderAdjustmentsValue() + getTotalTax()`" — which already omits shipping and fees, so it is evidently stale. The actual behavior, code, tests, and `setTotal` Javadoc all treat fees as part of the total.

---

## What Is Not Affected

- **`FulfillmentGroup.setTotal(fgTotal)`**: Completely unaffected. Fees are still in every FG's total. The FG totals will be inconsistent with `order.getTotal()` when fees exist.
- **`order.getTotalTax()`**: Fee taxes are set in `setTaxSums()` independently and remain in the order tax total.
- **`FulfillmentGroupFee` objects and amounts**: Not removed from persistence; `getFulfillmentGroupFees()` still returns the fees.
- **`order.getTotalShipping()`**: Set by `FulfillmentGroupPricingActivity` from `FulfillmentGroup.getFulfillmentPrice()`, which is the shipping rate only, not fees. Unchanged.
- **Orders with no `FulfillmentGroupFee`s**: Exactly zero behavioral change.

---

## Summary

Removing `total = total.add(fees)` is not a display-only change. It has concrete financial consequences in every pricing run for orders with SKU-level fulfillment fees:

1. **Under-charges third-party and credit-card payments** via `AdjustOrderPaymentsActivity` (same pricing workflow run, ORDER=9000).
2. **Lowers the checkout validation threshold** in `ValidateAndConfirmPaymentActivity`, potentially allowing under-authorized checkouts to succeed.
3. **Propagates undercharging** through `getTotalAfterAppliedPayments()` into passthrough payment creation, saved-card payment creation, and payment gateway request DTOs.
4. **Creates a structural inconsistency** between `FulfillmentGroup.getTotal()` (still includes fees) and `order.getTotal()` (no longer includes fees), and between `order.getTotalTax()` (still includes fee taxes) and `order.getTotal()` (missing the fee principal).
5. **Breaks three existing test assertions** in `TotalActivitySpec` and `PricingTest`.
6. **Understates GA4/UA revenue** reporting on order confirmation pages.

The only scenario in which this produces no behavioral change is when no `SkuFee` of type `FULFILLMENT` is defined on any SKU in any order — i.e., when the `fees` accumulator always stays at zero.