I now have enough information to provide a thorough analysis. Here it is.

---

## Impact Analysis: Removing `total = total.add(fees)` from `TotalActivity.execute`

### 1. What the current code does at lines 64–80

```java
// TotalActivity.java lines 55–80
Money total = BroadleafCurrencyUtils.getMoney(BigDecimal.ZERO, order.getCurrency());
total = total.add(order.getSubTotal());
total = total.subtract(order.getOrderAdjustmentsValue());
total = total.add(order.getTotalShipping());
if (order.getTotalTax() != null) {
    total = total.add(order.getTotalTax());
}

Money fees = BroadleafCurrencyUtils.getMoney(BigDecimal.ZERO, order.getCurrency());
for (FulfillmentGroup fulfillmentGroup : order.getFulfillmentGroups()) {
    Money fgTotal = ...
    fgTotal = fgTotal.add(fulfillmentGroup.getMerchandiseTotal());
    fgTotal = fgTotal.add(fulfillmentGroup.getShippingPrice());
    fgTotal = fgTotal.add(fulfillmentGroup.getTotalTax());
    for (FulfillmentGroupFee fulfillmentGroupFee : fulfillmentGroup.getFulfillmentGroupFees()) {
        fgTotal = fgTotal.add(fulfillmentGroupFee.getAmount());   // included in FG total
        fees = fees.add(fulfillmentGroupFee.getAmount());          // accumulated
    }
    fulfillmentGroup.setTotal(fgTotal);   // FG total includes fees
}

total = total.add(fees);     // LINE TO BE REMOVED
order.setTotal(total);
```

`fees` is the sum of `FulfillmentGroupFee.getAmount()` across all FulfillmentGroups. These fees originate in `ConsolidateFulfillmentFeesActivity` (ORDER=2000), which creates `FulfillmentGroupFee` records from `SkuFee` entities with type `SkuFeeType.FULFILLMENT` associated with SKUs. They are only present when SKUs carry such fees.

**Condition under which the change has zero effect:** any order that has no `FulfillmentGroupFee` records — `fees` is then $0.00 and removing the addition changes nothing.

---

### 2. What changes and what does not

After removing the statement:

| Field / result | Before | After |
|---|---|---|
| `Order.total` (stored in `BLC_ORDER.ORDER_TOTAL`) | subTotal − orderAdj + shipping + totalTax + fees | subTotal − orderAdj + shipping + totalTax (**fees excluded**) |
| `FulfillmentGroup.total` (stored per FG) | merchandiseTotal + shippingPrice + fg.totalTax + fees | **unchanged — still includes fees** |
| `Order.totalTax` | unchanged (fee taxes still totalled in `setTaxSums`) | unchanged |
| `fees` local var | accumulated normally | accumulated, then **silently discarded** |

The `fees` accumulation loop (lines 71–74) is not removed, so the local variable `fees` is still computed. Only its addition to `total` is eliminated. The FG-level total (`fulfillmentGroup.setTotal(fgTotal)`) at line 76 is also untouched.

---

### 3. Internal inconsistency: sum-of-FG-totals vs. Order.total

**`FulfillmentGroup.setTotal(fgTotal)`** at TotalActivity line 76 still includes fees. After the change:

```
sum(FulfillmentGroup.getTotal()) = Order.total + fees
```

This violates the contract stated at `Order.java` line 276–278:
> "Gets the total fulfillment costs … This value should be equivalent to the summation of `FulfillmentGroup#getTotal()` for each `FulfillmentGroup`"

Also violated is the Javadoc on `Order.setTotal()` at `Order.java` line 131–135:
> "the grand total of this Order … includes … taxes, fees, shipping and adjustments for all 3"

Further, `Order.totalTax` still includes fee taxes (because `setTaxSums()` — which is not changed — sums fee-level `TaxDetail` amounts into `fgTotalFeeTax` → `fgTotalTax` → `order.totalTax`, TotalActivity lines 148–176). The result after the change is:

```
Order.total = subTotal − orderAdj + shipping + (taxes on items + taxes on shipping + taxes on fees)
                                                              but NOT fee amounts themselves
```

Fee taxes are in `Order.total` but the fees themselves are not. This is a structural inconsistency that would be difficult to explain as intentional: customers would be charged tax on fees they are not being charged for (from Order.total's perspective).

---

### 4. Downstream behavioral consequences

**These are actual behavioral impacts on runtime logic, not just reference discovery:**

#### 4a. `AdjustOrderPaymentsActivity` (pricing workflow, ORDER=9000)
Source: `AdjustOrderPaymentsActivity.java` line 95:
```java
Money difference = order.getTotal().subtract(appliedPaymentsWithoutThirdPartyOrCC);
unconfirmedThirdPartyOrCreditCard.setAmount(difference);
```
This activity runs immediately after `TotalActivity` in the pricing workflow (workflow XML line 78–79). When a hosted gateway (e.g., PayPal Express) is in use, this sets the payment amount to cover whatever `Order.total` says. After the change, the hosted payment amount would be **understated by the fee amount** on every pricing cycle. The customer would be charged less than the true order cost at payment gateway confirmation.

#### 4b. `ValidateAndConfirmPaymentActivity` (checkout workflow, ORDER=3000)
Source: `ValidateAndConfirmPaymentActivity.java` line 256:
```java
if (paymentSum.lessThan(order.getTotal())) {
    throw new IllegalArgumentException("There are not enough payments to pay for the total order...");
}
```
The checkout gate validates `paymentSum >= order.getTotal()`. If `AdjustOrderPaymentsActivity` sets the third-party payment to the fee-reduced `order.total`, and no other payment covers the fees, the checkout validation would pass with an understated payment sum. **The order would be accepted for processing at a lower amount than the customer should owe.**

#### 4c. `OrderToPaymentRequestDTOServiceImpl.populateTotals()` (payment gateway integration)
Source: `OrderToPaymentRequestDTOServiceImpl.java` line 161:
```java
if (order.getTotalAfterAppliedPayments() != null) {
    total = order.getTotalAfterAppliedPayments().toString();
}
```
`getTotalAfterAppliedPayments()` is implemented in `OrderImpl.java` line 325:
```java
return myTotal.subtract(totalPayments);  // where myTotal = getTotal()
```
The transaction total sent to the payment gateway would be reduced by the fee amount.

#### 4d. `BroadleafCheckoutController` (passthrough payments)
Source: `BroadleafCheckoutController.java` lines 213, 218:
```java
passthroughPayment.setAmount(cart.getTotalAfterAppliedPayments());
transaction.setAmount(cart.getTotalAfterAppliedPayments());
```
COD and passthrough payments are set to `getTotalAfterAppliedPayments()`, which inherits the fee exclusion.

#### 4e. `BroadleafPaymentInfoController` (stored customer payment)
Source: `BroadleafPaymentInfoController.java` line 99:
```java
orderPaymentService.createOrderPaymentFromCustomerPayment(
    cart, customerPayment, cart.getTotalAfterAppliedPayments()
);
```
Stored payment method charges would also be understated.

#### 4f. `CheckoutFormVariableExpression.shouldShowAllPaymentMethods()` (checkout UI)
Source: `CheckoutFormVariableExpression.java` line 70:
```java
Money orderTotalAfterAppliedPayments = CartState.getCart().getTotalAfterAppliedPayments();
boolean totalCoveredByAppliedPayments = (orderTotalAfterAppliedPayments != null
        && orderTotalAfterAppliedPayments.isZero());
```
If gift cards or store credit have been applied that exactly cover the fee-reduced total, `shouldShowAllPaymentMethods()` returns `false` (hiding the payment form). But the fees are still owed in the FG totals and would not be collected.

#### 4g. Analytics processors (observational, not financial)
`GoogleAnalytics4Processor.java` line 198: `sb.append(",value: " + order.getTotal());`  
`GoogleUniversalAnalyticsProcessor.java` line 251: `sb.append(",'revenue': '" + order.getTotal() + "'");`  
Revenue reported to Google Analytics would be understated by the fee amount on orders that have fees. This is an analytics inconsistency, not a charge error, but could affect revenue reporting accuracy.

---

### 5. Concrete before/after example

Using data from `TotalActivitySpec.groovy`:

- `order.subTotal` = $10.00  
- `order.totalShipping` = $1.99  
- FG fee = $0.50  
- FG tax (items=$0.20 + FG=$0.20 + fee=$0.20) = $0.60 → `order.totalTax` = $0.60  

| | Before change | After change |
|---|---|---|
| `Order.total` | $10.00 + $1.99 + $0.60 + $0.50 = **$13.09** | $10.00 + $1.99 + $0.60 = **$12.59** |
| `FulfillmentGroup.total` | $13.09 | **$13.09** (unchanged) |
| FG-total minus Order-total | $0 | **$0.50 gap** |
| Payment amount (gateway) | covers $13.09 | understated by $0.50 |

With `taxOverride = true` (taxes zeroed):

| | Before | After |
|---|---|---|
| `Order.total` | $10.00 + $1.99 + $0.50 = **$12.49** | $10.00 + $1.99 = **$11.99** |

---

### 6. Tests that would break

**`TotalActivitySpec.groovy` — "Test TotalActivity with valid data"** (line 128):
```groovy
context.seedData.total.amount == 13.09
```
After the change this would yield $12.59 and **the test fails**.

**`TotalActivitySpec.groovy` — "Test TotalActivity with taxOverride enabled"** (line 140):
```groovy
context.seedData.total.amount == 12.49
```
After the change this would yield $11.99 and **the test fails**.

**`PricingTest.java` line 206** (integration test):
```java
assert (order.getTotal().equals(
    order.getSubTotal().add(order.getTotalTax()).add(order.getTotalShipping())
    .add(fulfillmentGroupFeeTotal)
    .subtract(order.getOrderAdjustmentsValue())));
```
This assertion explicitly expects fees to be in the total. After the change, the left side would be less than the right side by the `fulfillmentGroupFeeTotal` amount, and **the integration test fails**. The test setup at `PricingTest.java` lines 143–152 creates a `SkuFee` of type `FULFILLMENT` with amount $10 on the first SKU, so `fulfillmentGroupFeeTotal` is non-zero.

**Tests not expected to break:**
- `OfferServiceTest.java` line 252 — no `FulfillmentGroupFee`s are set up in that test; fee sum is $0.00, so the change is inert.
- `CheckoutTest.java` line 129 — only checks `order.total > order.subTotal`; passes as long as shipping or taxes exist; no fees are configured in that test.

---

### 7. Where impact cannot be established from this checkout

- Any **extension modules** (Account, tax integrations, ERP/OMS connectors) that consume `Order.getTotal()` or `FulfillmentGroup.getTotal()` are not in this repository. If such modules compare the two fields or use `Order.total` as an authoritative charge amount, they would be affected.
- **Payment gateway modules** (PayPal, Braintree, etc.) are not present; how they handle a lower transaction total than the sum of items+fees cannot be traced here.
- **Front-end templates** that display `order.total` (Thymeleaf/JSP outside the `broadleaf-framework-web` processors already found) may show an understated total to customers in order review screens.

---

### 8. Summary verdict

| Consequence | Condition | Intended? |
|---|---|---|
| `Order.total` decreases by sum of all FG fees | Any order with `SkuFeeType.FULFILLMENT` fees | Stated intent |
| Fee taxes remain in `Order.totalTax` and thus `Order.total` | Always | **Unintended inconsistency**: taxes on fees stay, fee amounts don't |
| `FulfillmentGroup.total` still includes fees, `Order.total` does not | Same | **Unintended inconsistency**: divergence between FG totals and order total |
| Payment gateway charged too little | Third-party or passthrough payment + fees present | **Unintended behavioral consequence** |
| Checkout payment validation may pass with insufficient funds | Same | **Unintended behavioral consequence** |
| Analytics under-reports revenue | Fees present | Minor, observational |
| 3 test suites fail (2 unit spec assertions, 1 integration assertion) | Fees present | Signals existing tests are incompatible with the change |

The change achieves its stated effect only if the intent is strictly "exclude fees from `Order.total`," but leaves `FulfillmentGroup.total` and fee-tax contributions to `Order.totalTax` unchanged, creating internal accounting inconsistencies. The most significant unintended consequence is in the payment layer: `AdjustOrderPaymentsActivity` and `ValidateAndConfirmPaymentActivity` both use `Order.total` as the authoritative amount to charge and validate, so removing fees from it would cause fees to go uncharged.