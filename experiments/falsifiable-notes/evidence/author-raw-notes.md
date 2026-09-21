Now I have sufficient evidence. Let me write the notes.

```markdown
# Checkout, Pricing, and Payment-Balance Notes (provisional)

*Repository branch: develop-7.0.x — source inference only; no tests executed.*

---

## Workflow Overview

```
HTTP layer → CheckoutService.performCheckout()
               └─ blCheckoutWorkflow (SequenceProcessor, ORDER constants below)
                    500  ValidateCheckoutActivity       (extension point only)
                    750  ValidateAvailabilityActivity
                   2000  ValidateProductOptionsActivity
                   3000  ValidateAndConfirmPaymentActivity ← payment confirmation + balance guard
                   5000  CommitTaxActivity
                   6000  DecrementInventoryActivity
                   7000  CompleteOrderActivity          → sets OrderStatus.SUBMITTED

blPricingService.executePricing() runs on every save via blPricingWorkflow:
    MIN+100  CountTotalOffersActivity
       1000  OfferActivity
       2000  ConsolidateFulfillmentFeesActivity
       3000  FulfillmentItemPricingActivity
       4000  FulfillmentGroupMerchandiseTotalActivity
       5000  FulfillmentGroupPricingActivity
       6000  ShippingOfferActivity
       7000  TaxActivity
       8000  TotalActivity                             ← sets order.total
       9000  AdjustOrderPaymentsActivity               ← rebalances unconfirmed final payment
    MAX-100  DetermineOfferChangeActivity
```

---

## Claim 1 – Re-checkout guard rejects SUBMITTED or CANCELLED orders

**Claim:** `CheckoutServiceImpl.performCheckout()` throws `CheckoutException` immediately, before touching the workflow, if the order's status is `SUBMITTED` or `CANCELLED`.

**Applies when:** Every call to `performCheckout()`. No configuration flag overrides it.

**Evidence:** `core/broadleaf-framework/…/checkout/service/CheckoutServiceImpl.java` lines 57-61 (`hasOrderBeenCompleted` checks `OrderStatus.SUBMITTED || OrderStatus.CANCELLED`). Source inference.

**Challenge:** Search for any subclass of `CheckoutServiceImpl` overriding `hasOrderBeenCompleted`; a subclass returning `false` would neutralize the guard. Run: `grep -r "hasOrderBeenCompleted" --include="*.java"`.

**Limits:** The `OrderStatus` enum may have custom values outside this repository that don't match either sentinel.

---

## Claim 2 – Order total = subtotal − adjustments + shipping + tax + FG fees

**Claim:** `TotalActivity` sets `order.total` to `subTotal − orderAdjustmentsValue + totalShipping + totalTax + sum(FulfillmentGroupFee.amount)`. If `totalTax` is `null` it is skipped (not treated as zero).

**Applies when:** Every pricing workflow execution. If `order.getTaxOverride()` is true, `setTaxSums` zeroes all tax values before the total is computed, so totalTax becomes zero.

**Evidence:** `core/broadleaf-framework/…/pricing/service/workflow/TotalActivity.java` lines 55-80 (source inference). Tax-null guard at line 60.

**Challenge:** Confirm `order.getSubTotal()` excludes or includes item-level discounts by tracing `FulfillmentGroupMerchandiseTotalActivity`. A test showing the wrong component would falsify the formula.

**Limits:** Custom `TotalActivity` subclasses injected via `blPricingWorkflow` could change the formula.

---

## Claim 3 – AdjustOrderPaymentsActivity mutates exactly one "final" unconfirmed payment

**Claim:** During pricing, `AdjustOrderPaymentsActivity` finds at most one active payment where `!payment.isConfirmed() && payment.isFinalPayment()` and sets its amount to `order.total − sum(all other active payment amounts)`. If zero or more-than-one such payments exist, the rebalancing is silently skipped (zero) or uses the last one found (multiple – loop overwrites).

**Applies when:** Executes at ORDER=9000 in the pricing workflow, after `TotalActivity`. Relevant for hosted-payment flows (PayPal Express) or server-side credit-card flows where the order total changes after the payment amount is set.

**Evidence:** `AdjustOrderPaymentsActivity.java` lines 81-97 (source inference). `isFinalPayment()` delegates to `PaymentType.getIsFinalPayment()` (`OrderPaymentImpl.java` line 344).

**Challenge:** Check behaviour when two UNCONFIRMED final payments exist (e.g., two credit cards). The loop would overwrite `unconfirmedThirdPartyOrCreditCard` on each iteration, leaving only the last one adjusted. Construct a scenario with `payment1.isFinalPayment()=true, !isConfirmed()` and `payment2.isFinalPayment()=true, !isConfirmed()` to observe which one gets the residual amount.

**Limits:** `isConfirmed()` returns `true` only when a successful AUTHORIZE or AUTHORIZE_AND_CAPTURE transaction exists (`OrderPaymentImpl.java` lines 331-340); it ignores PENDING.

---

## Claim 4 – `isFinalPayment` is a PaymentType-level property; only CREDIT_CARD, CUSTOMER_PAYMENT, APPLE_PAY, GOOGLE_PAY, and THIRD_PARTY_ACCOUNT are flagged `true`

**Claim:** `PaymentType.isFinalPayment` defaults to `false`. Of the built-in types, only `CREDIT_CARD`, `CUSTOMER_PAYMENT`, `APPLE_PAY`, `GOOGLE_PAY`, and `THIRD_PARTY_ACCOUNT` are constructed with `isFinalPayment=true`. Types such as `GIFT_CARD` and `CUSTOMER_CREDIT` are `false`, meaning they are never rebalanced by `AdjustOrderPaymentsActivity`.

**Applies when:** All callers of `payment.isFinalPayment()`, including `AdjustOrderPaymentsActivity` and `OrderPaymentConfirmationStrategyImpl`.

**Evidence:** `common/…/payment/PaymentType.java` lines 40-65 (source inference, literal constructor arguments inspected).

**Challenge:** A custom `PaymentType` instance registered via `PaymentType.getInstance()` could set `isFinalPayment=true` on GIFT_CARD. Grep for `new PaymentType(` to find non-default instantiations in the repository: `grep -r "new PaymentType(" --include="*.java"`.

**Limits:** Dynamic extension points allow new PaymentType instances at runtime; only static declarations were reviewed here.

---

## Claim 5 – Payment confirmation only targets payments in status UNCONFIRMED (exactly one successful UNCONFIRMED transaction)

**Claim:** `ValidateAndConfirmPaymentActivity` will attempt confirmation on a payment only when `determineOrderPaymentStatus(payment) == UNCONFIRMED`. `OrderPaymentStatusServiceImpl.determineUnconfirmed()` requires **exactly** one transaction in `payment.getTransactions()`, that transaction must have `success == true`, and its type must be `UNCONFIRMED`.

**Applies when:** Every active payment on the order during checkout. Does not apply to already-authorized (AUTHORIZE / AUTHORIZE_AND_CAPTURE) payments, which are added to `confirmedTransactions` for rollback tracking without being re-confirmed.

**Evidence:** `OrderPaymentStatusServiceImpl.java` lines 114-118; `ValidateAndConfirmPaymentActivity.java` lines 144-204 (source inference). The double condition at line 147-148 requires both the payment-level status check AND the transaction-type check.

**Challenge:** A payment with two successful UNCONFIRMED transactions would NOT satisfy `determineUnconfirmed` (size != 1) and would fall through to UNDETERMINED status, bypassing confirmation entirely. Create such a scenario to verify.

**Limits:** Custom `OrderPaymentStatusService` beans could change status determination logic.

---

## Claim 6 – Underpayment throws `IllegalArgumentException`; overpayment is permitted

**Claim:** After confirming all UNCONFIRMED transactions, `ValidateAndConfirmPaymentActivity` sums successful AUTHORIZE + AUTHORIZE_AND_CAPTURE + PENDING transaction amounts across all active payments. If `paymentSum < order.getTotal()` (strict less-than), an `IllegalArgumentException` is thrown. If `paymentSum > order.getTotal()`, no exception is thrown.

**Applies when:** End of `ValidateAndConfirmPaymentActivity.execute()`, lines 247-260. Applies after `AdjustOrderPaymentsActivity` has already rebalanced the final payment.

**Evidence:** `ValidateAndConfirmPaymentActivity.java` lines 247-260 using `paymentSum.lessThan(order.getTotal())` (source inference).

**Challenge:** Test exact equality at boundary: `paymentSum.equals(order.getTotal())` should not throw. Test with `paymentSum` one cent over total; if exception is still thrown, the `lessThan` semantics are wrong. Also check `Money.lessThan` implementation for currency-mismatch behaviour.

**Limits:** `paymentSum` includes PENDING transactions; whether PENDING amounts are actually charged is gateway-specific.

---

## Claim 7 – PENDING payment path is controlled by a system property

**Claim:** When `gateway.config.global.enablePendingPayments` resolves to `true` via `SystemPropertiesService`, `OrderPaymentConfirmationStrategyImpl.confirmTransaction()` short-circuits all gateway calls and returns a synthetic `PaymentResponseDTO` with type `PENDING` instead of AUTHORIZE or AUTHORIZE_AND_CAPTURE.

**Applies when:** Only on checkout-path confirmation (`isCheckout=true`). `confirmPendingTransaction()` always bypasses this flag.

**Evidence:** `OrderPaymentConfirmationStrategyImpl.java` lines 130-132, 282-284 (source inference). Property name `gateway.config.global.enablePendingPayments`.

**Challenge:** Verify that `SystemPropertiesService.resolveBooleanSystemProperty` returns `false` when the property is absent (unset = disabled). An implementation that returns `true` on absent would change the default behaviour.

**Limits:** `SystemPropertiesService` resolution (database, config file, or other) is not examined here.

---

## Claim 8 – Failed transaction handling defaults to `CheckoutException`; rollback of failed transactions defaults to off

**Claim:** `handleUnsuccessfulTransactions` defaults to throwing `CheckoutException`. `shouldRollbackFailedTransaction` always returns `false`, so failed confirmation transactions are archived via `markPaymentAsInvalid` rather than rolled back by default.

**Applies when:** Any UNCONFIRMED transaction confirmation that returns `responseDTO.isSuccessful() == false`.

**Evidence:** `ValidateAndConfirmPaymentActivity.java` lines 280-333 (source inference). `shouldRollbackFailedTransaction` at line 331 returns `false` unconditionally.

**Challenge:** Override `shouldRollbackFailedTransaction` in a subclass to return `true` for fraud-check scenarios. Verify that the alternative code path at lines 295-296 is exercised and that the failed transaction is added to rollback state rather than being invalidated.

**Limits:** The fraud-check use case is documented in comments but not tested in-repository.

---

## Claim 9 – Rollback only reverses AUTHORIZE and AUTHORIZE_AND_CAPTURE; other confirmed types are logged and skipped

**Claim:** `ConfirmPaymentsRollbackHandler.rollbackState()` calls `rollbackAuthorize()` or `rollbackAuthorizeAndCapture()` on the gateway's rollback service only for those two transaction types. All other types (e.g., PENDING) emit a WARN log and are not reversed.

**Applies when:** Any downstream workflow failure after `ValidateAndConfirmPaymentActivity` completes.

**Evidence:** `ConfirmPaymentsRollbackHandler.java` lines 108-120 (source inference).

**Challenge:** Introduce a PENDING transaction in `confirmedTransactions` and verify the log warning is emitted and no gateway call occurs.

**Limits:** `cfg.getRollbackService()` may be `null` even for AUTHORIZE types; if so, no rollback occurs and no error is raised (lines 109-110 check for null before calling).

---

## Omitted Scope

- Tax commit/rollback (`CommitTaxActivity`, `CommitTaxRollbackHandler`) not examined.
- Fulfillment item pricing and discount distribution (`FulfillmentItemPricingActivity`, `OfferActivity`) not examined.
- `DefaultPaymentGatewayCheckoutService.markPaymentAsInvalid()` internals not examined.
- Multi-tenant/site isolation not examined.
- Integration test (`CheckoutTest.java`, `PricingTest.java`) contents not examined; no tests were executed.
```