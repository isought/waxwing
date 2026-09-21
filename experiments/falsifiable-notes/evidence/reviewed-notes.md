# Checkout, pricing and balances: provisional notes

Inspected revision: `5036306fcbd95180135a9ce0dc16b574f032936b`. Source inference only; no tests executed. These notes describe default implementations, not all application extensions or gateway behavior.

For source anchors below, `J/` means `core/broadleaf-framework/src/main/java/org/broadleafcommerce/core/`, `W/` means `core/broadleaf-framework-web/src/main/java/org/broadleafcommerce/core/`, and `R/` means `core/broadleaf-framework/src/main/resources/`. Append the specified suffix to resolve each repository-relative file.

## Workflow orientation

Pricing computes totals and then adjusts an eligible final payment. Checkout is a separate workflow: validation and payment confirmation precede tax commit, inventory decrement and completion. Do not assume every save reprices: `CheckoutServiceImpl.performCheckout` uses `orderService.save(order, false)` before entering its workflow. Inspect the actual caller and configured activities for the route being changed.

## 1. Re-checkout guard

**Claim:** The default `CheckoutServiceImpl.performCheckout` rejects an order already SUBMITTED or CANCELLED before starting its workflow.

**Applies when:** This implementation and its default `hasOrderBeenCompleted` method are used.

**Evidence:** `J/checkout/service/CheckoutServiceImpl.java`, `performCheckout` lines 56–69 and `hasOrderBeenCompleted` lines 97–99.

**Challenge:** Search Java sources for `hasOrderBeenCompleted` and subclasses of `CheckoutServiceImpl`. An override changing the accepted statuses defeats applying this rule to that subclass.

**Limits:** External subclasses and active bean replacement have not been established.

## 2. Pricing total and tax override

**Claim:** `TotalActivity.execute` sets order total to subtotal minus order adjustments plus shipping, non-null totalTax, and the sum of fulfillment-group fee amounts. Its group-total loop separately includes each group's fees.

**Applies when:** This activity runs. `setTaxSums` executes first; taxOverride clears tax details and zeros tax totals. Without override, fee taxes contribute to group and order tax sums.

**Evidence:** `J/pricing/service/workflow/TotalActivity.java`, `execute` lines 50–83 and `setTaxSums` lines 86–177.

**Challenge:** Inspect both the group and order accumulation statements, then inspect the early taxOverride branch. A skipped component, later overwrite, or configured replacement activity can defeat using this formula on another route.

**Limits:** Discount derivation and whether group totals should sum to order total are not established here.

## 3. Remaining balance is a derived value

**Claim:** `OrderImpl.getTotalAfterAppliedPayments` returns order total minus active, non-null payment amounts for which `!isFinalPayment() || isConfirmed()`. It returns null if order total is null. The method does not clamp negative results.

**Applies when:** This implementation is used; unconfirmed final payments are excluded, while non-final payments do not require confirmation.

**Evidence:** `J/order/domain/OrderImpl.java`, `getTotalAfterAppliedPayments` lines 325–338. `J/payment/domain/OrderPaymentImpl.java` lines 331–344 defines confirmation and delegates final-payment classification to the payment type.

**Challenge:** Inspect the exact selection predicate with active/inactive, final/non-final and confirmed/unconfirmed payments; calculate balances with applied amounts below, equal to and above total. A clamp or different included-payment predicate contradicts this rule.

**Limits:** This derived balance is not itself proof of settled funds or the amount every gateway receives.

## 4. Pricing adjusts the last eligible final payment

**Claim:** `AdjustOrderPaymentsActivity` adjusts at most one payment: the last active, unconfirmed final payment encountered. Its new amount is order total minus active, non-null amounts from payments outside that eligible category. Other eligible unconfirmed final payments are neither subtracted nor adjusted.

**Applies when:** This activity executes and at least one eligible payment exists. The default pricing activity list places it after TotalActivity.

**Evidence:** `J/pricing/service/workflow/AdjustOrderPaymentsActivity.java` lines 78–100; `R/bl-framework-applicationContext-workflow.xml`, `blPricingWorkflowActivities` lines 67–83.

**Challenge:** Trace two eligible payments through the loop and inspect the subtraction and assignment for a negative remainder. An accumulator including another eligible final payment, a clamp, or a differently configured activity order changes this conclusion.

**Limits:** The adjustment is not guaranteed to have run merely because checkout was called.

## 5. Checkout's payment-sum guard

**Claim:** This guard rejects a sum below order total, but does not reject an equal or greater sum. It sums successful AUTHORIZE, AUTHORIZE_AND_CAPTURE and PENDING transaction amounts across active payments.

**Applies when:** Execution reaches the final sum check in the default ValidateAndConfirmPaymentActivity after transaction handling.

**Evidence:** `J/checkout/service/workflow/ValidateAndConfirmPaymentActivity.java` lines 244–260.

**Challenge:** Read the exact comparison and evaluate a sum one cent below, equal to, and above total. An equality requirement would contradict this claim.

**Limits:** Other workflow checks can still fail. Counting PENDING does not establish that money settled.

## 6. Payment-method visibility

**Claim:** A non-null remaining balance counts as covered only when it is exactly zero; a negative remaining balance does not count as covered.

**Applies when:** In default `shouldShowAllPaymentMethods`, the return is false if there is a third-party payment or the balance counts as covered; otherwise true.

**Evidence:** `W/web/expression/checkout/CheckoutFormVariableExpression.java`, `shouldShowAllPaymentMethods` lines 69–74.

**Challenge:** Inspect the exact balance predicate and evaluate positive, zero and negative balances, both with and without a third-party payment. A result differing from the claim falsifies its application to that case.

**Limits:** This describes the expression's return value, not every rendered payment component or downstream gateway acceptance.

## Omitted scope

Gateway request mapping, passthrough payment creation, rollback, analytics, configured application overrides, and integration/regression fixtures require separate investigation. Business intent is not inferred from existing code. No claim of exhaustive impact coverage is made.
