# Field-impact baseline: checklist recorded before the model run

Date: 2026-09-14. Public repository: https://github.com/BroadleafCommerce/BroadleafCommerce
Commit: 5036306fcbd95180135a9ce0dc16b574f032936b.
Checkout: /tmp/waxwing-field-impact-broadleaf-20260914.
Size: 3,861 tracked-visible files, including 2,985 Java files (rg --files counts).

Question: Can a fresh coding agent, using ordinary text search and file reads, explain the consequences of removing fulfillment-group fees from Order.total while leaving the other rules unchanged?

This is one deliberately concrete exploratory case. It tests source-based impact analysis, not runtime validation, exhaustive impact coverage, all Java systems, token savings, or a Waxwing treatment effect. The proposed edit is hypothetical; it is not a known historical defect. The subject gets the edit location, because the use case is a developer considering a known rule change.

The evaluator inspected source with rg and sed before the subject was run. These are independently assembled, source-supported checks, NOT a complete ground truth. No expected findings are passed to the subject. No rubric will be silently expanded after the run; additional findings will be recorded separately. No repository build or application-level test has yet been executed.

## Checklist (0 = missing/wrong, 0.5 = partial, 1 = supported with mechanism)

1. Derivation and delta: Order.total = subtotal - order adjustments + shipping + tax + fees. New total is old total minus the aggregate fee amounts; net-zero fees have no total effect. TotalActivity.java:56-80.
2. Fulfillment totals: each FulfillmentGroup.total still includes its own fee amounts. The edit creates a difference in fee inclusion between order and group totals; do not claim that these totals necessarily reconciled in every scenario beforehand. TotalActivity.java:65-76.
3. Tax: fee tax stays in group and order totalTax through setTaxSums, unless taxOverride clears it. Removing fees alone does not remove their tax. TotalActivity.java:87-177.
4. Remaining balance: OrderImpl.getTotalAfterAppliedPayments subtracts active, non-null applied amounts except unconfirmed final payments; balances drop and may become zero or negative. OrderImpl.java:325-338.
5. Payment adjustment: pricing workflow runs TotalActivity before AdjustOrderPaymentsActivity. An active unconfirmed final payment is set to total minus other applicable payments; changed amounts and possible negative remainder. AdjustOrderPaymentsActivity.java:79-97 and bl-framework-applicationContext-workflow.xml:67-79.
6. Payment request mapping: OrderToPaymentRequestDTOServiceImpl.populateTotals maps remaining balance to PaymentRequestDTO.transactionTotal while shipping/tax use their independent fields. Distinguish this path from all possible gateway transaction paths. OrderToPaymentRequestDTOServiceImpl.java:156-176.
7. Checkout guard: ValidateAndConfirmPaymentActivity sums successful AUTHORIZE / AUTHORIZE_AND_CAPTURE / PENDING for active payments and rejects only amounts below order total. Lower total lowers this threshold; equality is not enforced by this check. ValidateAndConfirmPaymentActivity.java:245-260.
8. UI decision: CheckoutFormVariableExpression.shouldShowAllPaymentMethods checks remaining balance isZero (not <= 0), with third-party-payment qualification. Exact-zero balance may hide methods; negative balance is different. CheckoutFormVariableExpression.java:69-74.
9. Propagation into another stored amount: processPassthroughCheckout copies remaining total into both OrderPayment.amount and PaymentTransaction.amount. BroadleafCheckoutController.java:209-220. Alternatively a comparably evidenced stored downstream field earns this check.
10. Concrete regression arithmetic: existing TotalActivitySpec expects 13.09 with tax and 12.49 with taxOverride for a 0.50 fee. Proposed values become 12.59 and 11.99, respectively. Existing PricingTest also asserts fee inclusion. These are predictions until run, not observed execution.

## Interpretation rules

- 8-10 supported checks with no serious unsupported impact claim: this case is evidence against needing a graph/product to perform the analysis.
- Missing checks indicate candidate shortcomings, not proof that a graph would fix them.
- Do not treat reference counts as impact coverage.
- Do not claim safety or completeness from a finite checklist or a single stochastic run.
- Report actual model, tool calls, time, token usage, cost estimate, permission errors, and any unexpected tools or outside-root reads from the transcript.
- Subject is fresh and receives no experiment history, findings, or this checklist. Its available tools are only Grep, Glob, Read; skills, MCP servers, browser integration and configured hooks are disabled.
