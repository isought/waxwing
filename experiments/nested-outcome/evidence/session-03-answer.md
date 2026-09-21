Now I have everything I need to trace all four requests. Let me work through the logic.

---

## Shared Pricing Computation (all four requests use qty=10, unitPrice=1200, currency=EUR)

**1. Amounts** (`Amounts.java:6`): `subtotal = 10 × 1200 = 12 000`

**2. Discounts** (`Discounts.java:12-13`): threshold=10 000, basisPoints=1 000. Since 12 000 ≥ 10 000: `discount = 12000 × 1000 / 10000 = 1 200`

**3. Delivery** (`Delivery.java:8`): freeFrom=10 000. Since 12 000 − 1 200 = 10 800 ≥ 10 000: `delivery = 0`

**4. Totals** (`Totals.java:8-10`, `TaxTable.java:7-8`): net=10 800, tax.EUR=2 000 bps → `tax = 10800 × 2000 / 10000 = 2 160`, `total = 10 800 + 2 160 = **12 960**`

---

## Recording Stage — where accounts diverge

**Posting selection** (`PostingRegistry.java:12-13`): key = `posting.<region>.<terms>`.
- EU+NET30 → `posting.EU.NET30 = deferred` (DeferredPosting / ExposureBook check)
- US+NET30 → `posting.US.NET30 = prepaid` (PrepaidPosting, only checks amount ≥ 0)

**ExposureBook** (`Bucket.java:7-8`): throws `CapacityExceeded` if `booked + amount > ceiling`.

**PreparedQuotes** (`PreparedQuotes.java:15-16`): catches `CapacityExceeded` → throws `StoreConflict("ACCOUNT_CAPACITY", accountId, …)`.

**ResponseMapper** (`ResponseMapper.java:11-18`): `StoreConflict` → 409; success → 201 with `{"account":…,"currency":…,"x":<total>}`.

---

## Per-account results

| Account | region/terms | posting | ceiling | booked | booked+12960 | result |
|---------|-------------|---------|---------|--------|-------------|--------|
| A17 | EU / NET30 | deferred | 50 000 | 38 000 | **50 960 > 50 000** ❌ | CapacityExceeded |
| B29 | EU / NET30 | deferred | 50 000 | 36 000 | 48 960 ≤ 50 000 ✅ | OK |
| C31 | EU / NET30 | deferred | 50 000 | 37 040 | **50 000 ≤ 50 000** ✅ (strict `>` in `Bucket.java:8`) | OK |
| D44 | US / NET30 | prepaid | — | — | amount ≥ 0 ✅ | OK |

---

## Final answers

**`new Request("A17", 10, 1200, "EUR")`**
- Status **409**
- Body: `{"code":"ACCOUNT_CAPACITY","account":"A17"}`
- Reason: `Bucket.append` at `Bucket.java:8` throws `CapacityExceeded` (38 000 + 12 960 = 50 960 > 50 000); `PreparedQuotes.java:16` wraps it as `StoreConflict`; `ResponseMapper.java:11-13` maps to 409.

**`new Request("B29", 10, 1200, "EUR")`**
- Status **201**
- Body: `{"account":"B29","currency":"EUR","x":12960}`
- Reason: 36 000 + 12 960 = 48 960 ≤ 50 000, deferred posting succeeds; `ResponseMapper.java:5-8` returns 201.

**`new Request("C31", 10, 1200, "EUR")`**
- Status **201**
- Body: `{"account":"C31","currency":"EUR","x":12960}`
- Reason: 37 040 + 12 960 = 50 000, which is **not strictly greater than** 50 000 (`Bucket.java:8` uses `>`), so no exception; 201 returned.

**`new Request("D44", 10, 1200, "EUR")`**
- Status **201**
- Body: `{"account":"D44","currency":"EUR","x":12960}`
- Reason: D44 is region=US/terms=NET30 → `posting.US.NET30 = prepaid` (`application.properties:10`); `PrepaidPosting.java:4` only rejects negative amounts; 12 960 ≥ 0, so it succeeds. (The exposure ceiling of 49 000 is never consulted for prepaid accounts.)