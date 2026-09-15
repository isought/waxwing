Now I have all the code needed to trace each request. Let me work through the logic.

---

## Pricing pipeline (identical for all four requests)

**Config** (`application.properties`): `quote.route=amounts,discounts,delivery,totals,recording`

**Stage 1 – Amounts** (`Amounts.java:6`):
`subtotal = 10 × 1200 = 12 000`

**Stage 2 – Discounts** (`Discounts.java:12-13`, threshold=10 000, basisPoints=1 000):
`12 000 ≥ 10 000` → `discount = 12 000 × 1 000 / 10 000 = 1 200`

**Stage 3 – Delivery** (`Delivery.java:8`, freeFrom=10 000, fee=500):
`12 000 − 1 200 = 10 800 ≥ 10 000` → `delivery = 0`

**Stage 4 – Totals** (`Totals.java:8-10`, `tax.EUR=2000`):
`net = 10 800`; `tax = 10 800 × 2 000 / 10 000 = 2 160`; `total = 10 800 + 2 160 = **12 960**`

---

## Stage 5 – Recording (account-specific)

**Posting selection** (`PostingRegistry.java:12-13`):
Key = `"posting." + region + "." + terms`. Matching config key wins; fallback is `posting.default=prepaid`.

- **A17, B29, C31** (all EU/NET30, `accounts.properties:1-6`): key `posting.EU.NET30=deferred` → **DeferredPosting**
- **D44** (US/NET30, `accounts.properties:7-8`): key `posting.US.NET30=prepaid` → **PrepaidPosting**

**DeferredPosting** calls `Bucket.append(total)` (`Bucket.java:6-9`):
`if (next > ceiling) throw CapacityExceeded`   ← strictly greater-than

| Account | ceiling | booked | booked + 12 960 | > ceiling? |
|---------|---------|--------|-----------------|------------|
| A17 | 50 000 | 38 000 | **50 960** | ✓ throws |
| B29 | 50 000 | 36 000 | 48 960 | ✗ OK |
| C31 | 50 000 | 37 040 | **50 000** | ✗ OK (equal, not greater) |

`CapacityExceeded` → `PreparedQuotes.java:15-16` wraps it in `StoreConflict("ACCOUNT_CAPACITY", accountId, ...)` → `QuoteEndpoint.java:14-15` catches it → `ResponseMapper.failure` (`ResponseMapper.java:11-13`).

**PrepaidPosting** (`PrepaidPosting.java:4`): only rejects negative amounts; 12 960 > 0 → OK.

---

## Final answers

**`new Request("A17", 10, 1200, "EUR")`**
- Status **409**
- Body `{"code":"ACCOUNT_CAPACITY","account":"A17"}`
- Reason: 38 000 + 12 960 = 50 960 > ceiling 50 000 → `CapacityExceeded` → `StoreConflict`

**`new Request("B29", 10, 1200, "EUR")`**
- Status **201**
- Body `{"account":"B29","currency":"EUR","x":12960}`
- Reason: 36 000 + 12 960 = 48 960 ≤ 50 000; deferred posting succeeds

**`new Request("C31", 10, 1200, "EUR")`**
- Status **201**
- Body `{"account":"C31","currency":"EUR","x":12960}`
- Reason: 37 040 + 12 960 = 50 000, the check is `next > ceiling` (strict), so exactly at ceiling is not rejected

**`new Request("D44", 10, 1200, "EUR")`**
- Status **201**
- Body `{"account":"D44","currency":"EUR","x":12960}`
- Reason: US/NET30 maps to `prepaid` posting (`application.properties:10`); `PrepaidPosting` has no capacity guard, just rejects negative amounts