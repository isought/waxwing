Now I have sufficient evidence to give a complete analysis. Let me compose the response.

---

## Impact Analysis: Removing `total = total.add(fees)` from `TotalActivity.execute`

### Source anchor for the change

**File:** `core/broadleaf-framework/src/main/java/org/broadleafcommerce/core/pricing/service/workflow/TotalActivity.java`

The method currently at lines 64–80:

```java
Money fees = BroadleafCurrencyUtils.getMoney(BigDecimal.ZERO, order.getCurrency());
for (FulfillmentGroup fulfillmentGroup : order.getFulfillmentGroups()) {
    Money fgTotal = BroadleafCurrencyUtils.getMoney(BigDecimal.ZERO, order.getCurrency());
    fgTotal = fgTotal.add(fulfillmentGroup.getMerchandiseTotal());
    fgTotal = fgTotal.add(fulfillmentGroup.getShippingPrice());
    fgTotal = fgTotal.add(fulfillmentGroup.getTotalTax());

    for (FulfillmentGroupFee fulfillmentGroupFee : fulfillmentGroup.getFulfillmentGroupFees()) {
        fgTotal = fgTotal.add(fulfillmentGroupFee.getAmount());  // fee into fgTotal
        fees = fees.add(fulfillmentGroupFee.getAmount());        // fee into order-level accumulator
    }
    fulfillmentGroup.setTotal(fgTotal);                          // FG total includes fees
}

total = total.add(fees);   // ← LINE 79, PROPOSED REMOVAL
order.setTotal(total);     // line 80
```

---

### When the change has any effect at all

Only when at least one `FulfillmentGroupFee` with a non-zero `amount` is attached to a fulfillment group. If no fees exist, `fees` stays at zero and removing the statement is a no-op.

---

## Consequence 1 — `order.getTotal()` is reduced by the fee sum (direct)

**Behavioral:** `order.setTotal(total)` will write a value that is lower than the current value by the sum of all `FulfillmentGroupFee.getAmount()` across all groups.

**Example:** Subtotal $100, shipping $10, tax $5, one fee of $4.  
- Before: `order.getTotal()` = $119  
- After: `order.getTotal()` = $115

---

## Consequence 2 — `FulfillmentGroup.getTotal()` is NOT changed (internal inconsistency)

The loop inside `TotalActivity.execute` at lines 66–76 still adds each fee to `fgTotal`, then calls `fulfillmentGroup.setTotal(fgTotal)` at line 76. That call is **before** line 79 and is unaffected by the removal. So each group's own total continues to include its fees.

After the change:

| Field | Includes fees? |
|---|---|
| `FulfillmentGroup.getTotal()` for each group | **Yes** (unchanged) |
| `order.getTotal()` | **No** (reduced) |

Sum of all `FulfillmentGroup.getTotal()` > `order.getTotal()` by the fee amount.

This is an **internal inconsistency**: the group-level totals contradict the order-level total. Any code that iterates groups and sums their totals will compute a larger number than `order.getTotal()`.

**Note on `getTotalShipping()` / `getTotalFulfillmentCharges()`:** That field is set by `FulfillmentGroupPricingActivity` (ORDER=5000, runs before TotalActivity) from `fulfillmentGroup.getFulfillmentPrice()` — pure shipping cost, not `FulfillmentGroup.getTotal()`. The `Order.java` Javadoc comment at lines 276–278 says `getTotalFulfillmentCharges()` should equal the summation of `FulfillmentGroup#getTotal()` for each group — but that claim is already inconsistent with the actual code even today. The proposed change makes it more inconsistent by creating a second mis-match (group totals include fees; order total does not).

---

## Consequence 3 — `AdjustOrderPaymentsActivity` sets the final payment too low (financial)

**File:** `core/broadleaf-framework/src/main/java/org/broadleafcommerce/core/pricing/service/workflow/AdjustOrderPaymentsActivity.java`  
**Activity order:** ORDER = 9000, runs immediately after TotalActivity (ORDER = 8000). Both are listed in `blPricingWorkflowActivities` in `bl-framework-applicationContext-workflow.xml` lines 77–78.

At line 95:
```java
Money difference = order.getTotal().subtract(appliedPaymentsWithoutThirdPartyOrCC);
unconfirmedThirdPartyOrCreditCard.setAmount(difference);
```

This activity adjusts the amount on the one unconfirmed "final payment" (PayPal Express, unconfirmed credit card) to `order.getTotal() − other payments`. With a lower `order.getTotal()`, the final payment is set lower by the fee total.

**Example:** Order total $119 (with $4 fee), gift card $10 applied.  
- Before: PayPal amount = $119 − $10 = $109  
- After: PayPal amount = $115 − $10 = $105 (undercovers by $4)

**Condition:** Requires an unconfirmed final payment on the order. This is the common PayPal Express Checkout and server-side CC flows.

---

## Consequence 4 — `ValidateAndConfirmPaymentActivity` threshold falls (checkout)

**File:** `core/broadleaf-framework/src/main/java/org/broadleafcommerce/core/checkout/service/workflow/ValidateAndConfirmPaymentActivity.java`  
Line 256:
```java
if (paymentSum.lessThan(order.getTotal())) {
    throw new IllegalArgumentException("There are not enough payments...");
}
```

`paymentSum` is the sum of successful AUTHORIZE / AUTHORIZE_AND_CAPTURE / PENDING transaction amounts. The guard requires `paymentSum >= order.getTotal()`. After the change, `order.getTotal()` is lower by the fee amount, so the bar for this check falls. An order that would have **failed** the guard (because payments were short by the fee amount) could now **pass** it, proceeding to completion while the business is short by the fee total.

**Condition:** Only matters if there are fees and the authorized amount is exactly enough to cover the fee-excluded total but not the full amount.

---

## Consequence 5 — `getTotalAfterAppliedPayments()` is lower (derived, ripple)

**File:** `core/broadleaf-framework/src/main/java/org/broadleafcommerce/core/order/domain/OrderImpl.java`  
Lines 325–338:
```java
public Money getTotalAfterAppliedPayments() {
    Money myTotal = getTotal();
    ...
    return myTotal.subtract(totalPayments);
}
```

`getTotal()` is lower, so this derived value is lower by the same fee amount. Everything that calls this method inherits the reduction.

### 5a. Passthrough payment in `BroadleafCheckoutController`

**File:** `core/broadleaf-framework-web/src/main/java/org/broadleafcommerce/core/web/controller/checkout/BroadleafCheckoutController.java`  
Lines 213, 218:
```java
passthroughPayment.setAmount(cart.getTotalAfterAppliedPayments());
transaction.setAmount(cart.getTotalAfterAppliedPayments());
```
The passthrough payment and its transaction would be created for an amount that excludes fees.

### 5b. Customer payment size in `BroadleafPaymentInfoController`

**File:** `core/broadleaf-framework-web/src/main/java/org/broadleafcommerce/core/web/controller/checkout/BroadleafPaymentInfoController.java`  
Line 99:
```java
cart.getTotalAfterAppliedPayments()
```
Payment created from a saved customer payment profile would be sized without fees.

### 5c. Payment gateway request amount (`OrderToPaymentRequestDTOServiceImpl`)

**File:** `core/broadleaf-framework/src/main/java/org/broadleafcommerce/core/payment/service/OrderToPaymentRequestDTOServiceImpl.java`  
Lines 161–162:
```java
if (order.getTotalAfterAppliedPayments() != null) {
    total = order.getTotalAfterAppliedPayments().toString();
}
...
requestDTO.transactionTotal(total)...
```

The `transactionTotal` sent to external payment gateways would exclude fees. This is the most financially consequential downstream point: the gateway would authorize/capture less than the actual charge to the customer.

**Condition:** Applies whenever a final payment exists and fees are non-zero.

### 5d. `CheckoutFormVariableExpression.shouldShowAllPaymentMethods()`

**File:** `core/broadleaf-framework-web/src/main/java/org/broadleafcommerce/core/web/expression/checkout/CheckoutFormVariableExpression.java`  
Lines 70–74:
```java
Money orderTotalAfterAppliedPayments = CartState.getCart().getTotalAfterAppliedPayments();
boolean totalCoveredByAppliedPayments = (orderTotalAfterAppliedPayments != null
        && orderTotalAfterAppliedPayments.isZero());
return !cartStateService.cartHasThirdPartyPayment() && !totalCoveredByAppliedPayments;
```

If a customer's non-final payments exactly cover the fee-excluded total but not the full order, the UI would report the order as covered and hide payment method options — incorrectly.

---

## Consequence 6 — Analytics report reduced revenue

**File:** `core/broadleaf-framework-web/src/main/java/org/broadleafcommerce/core/web/processor/GoogleAnalytics4Processor.java`  
Line 198: `sb.append(",value: " + order.getTotal());`

**File:** `core/broadleaf-framework-web/src/main/java/org/broadleafcommerce/core/web/processor/GoogleUniversalAnalyticsProcessor.java`  
Line 251: `sb.append(",'revenue': '" + order.getTotal() + "'");`

Both GA integrations read `order.getTotal()` and emit it as the purchase value/revenue. Fee amounts would silently drop out of analytics data for every order that has fees.

---

## Consequence 7 — Debug log in `OrderServiceImpl` shows incomplete total

**File:** `core/broadleaf-framework/src/main/java/org/broadleafcommerce/core/order/service/OrderServiceImpl.java`  
Line 1205: `.addRow("Total", order.getTotal())`

Minor: the debug-level order summary log would show the fee-excluded total without any label to indicate fees are missing.

---

## Integration test that would fail

**File:** `integration/src/test/java/org/broadleafcommerce/core/pricing/service/PricingTest.java`  
Line 206:
```java
assert (order.getTotal().equals(
    order.getSubTotal()
        .add(order.getTotalTax())
        .add(order.getTotalShipping())
        .add(fulfillmentGroupFeeTotal)           // ← explicitly asserts fees are in total
        .subtract(order.getOrderAdjustmentsValue())));
```
`getFulfillmentGroupFeeTotal(order)` at lines 209–217 sums all `FulfillmentGroupFee.getAmount()` on the order. After the change, `order.getTotal()` would be short by exactly that amount, and the assertion would fail.

---

## Pre-existing documentation mismatch (not caused by this change)

`Order.java` line 56 Javadoc says:
> "3d. `getTotal()` : The order total (equivalent of `getSubTotal()` − `getOrderAdjustmentsValue()` + `getTotalTax()`)"

This description already omits both shipping and fees — both of which are currently included. The proposed change would not fix this stale documentation; it would make `order.getTotal()` accidentally closer to the documented formula (subtotal − adjustments + tax + shipping, without fees), but only for the fee component.

---

## Summary table

| Downstream point | Effect of removal | Requires fees > 0 |
|---|---|---|
| `order.getTotal()` | Reduced by sum of all FG fees | Yes |
| `FulfillmentGroup.getTotal()` | **Unchanged** — still includes fees (inconsistency) | Yes |
| Sum of FG totals > order total | New internal inconsistency created | Yes |
| `AdjustOrderPaymentsActivity` final payment amount | Under-set by fee total | Yes + final payment exists |
| `ValidateAndConfirmPaymentActivity` payment-sum guard | Bar drops; underfunded checkouts may pass | Yes |
| `OrderImpl.getTotalAfterAppliedPayments()` | Returns lower value by fee total | Yes |
| `BroadleafCheckoutController` passthrough payment & transaction | Sized without fees | Yes |
| `BroadleafPaymentInfoController` customer payment | Sized without fees | Yes |
| `OrderToPaymentRequestDTOServiceImpl` gateway request | `transactionTotal` excludes fees | Yes |
| `CheckoutFormVariableExpression.shouldShowAllPaymentMethods` | May hide payment form prematurely | Yes + near-covered order |
| Google Analytics 4 and Universal Analytics revenue/value | Fees silently omitted from reported purchase | Yes |
| `OrderServiceImpl` debug log total | Understated | Yes |
| `PricingTest` line 206 integration test | Fails | Yes |

---

## What cannot be established from this checkout

- Whether any active application deployment actually creates `FulfillmentGroupFee` records, and with what typical amounts — this is application-specific configuration not visible here.
- Whether gateway rollback or void flows reference `order.getTotal()` — no rollback handling was found in scope that reads the order-level total, but gateway-module code is outside this repository.
- Whether application-level overrides of `TotalActivity`, `AdjustOrderPaymentsActivity`, or `OrderImpl` exist in deployment — no subclasses of those were found within this repository, but external modules are not ruled out.