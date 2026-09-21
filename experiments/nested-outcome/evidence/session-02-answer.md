Now I have everything I need. Let me trace through the full pipeline for each request.

---

## Common pricing math (all four requests share the same inputs)

`Request(account, 10, 1200, "EUR")` — each runs fresh, no shared state.

**Stage 1 – Amounts** (`Amounts.java:6`):
`subtotal = 10 × 1200 = 12 000`

**Stage 2 – Discounts** (`Discounts.java:12–13`, `application.properties` threshold=10000, basisPoints=1000):
`12000 ≥ 10000` → `discount = 12000 × 1000 / 10000 = 1200`

**Stage 3 – Delivery** (`Delivery.java:8`, freeFrom=10000, fee=500):
`subtotal − discount = 10800 ≥ 10000` → `delivery = 0`

**Stage 4 – Totals** (`Totals.java:8–10`, `TaxTable.java:7–8`, tax.EUR=2000):
`net = 12000 − 1200 + 0 = 10800`
`tax = 10800 × 2000 / 10000 = 2160`
`total = 10800 + 2160 = **12960**`

---

## Stage 5 – Recording (account-specific)

`Recording.java:7` → `PreparedQuotes.save()` → `allocations.record(accountId, 12960)` → `PostingRegistry.select()` → posting strategy chosen by `posting.<region>.<terms>` key (`PostingRegistry.java:12–13`).

**A17 & B29 & C31**: `accounts.properties` gives region=EU, terms=NET30 → key `posting.EU.NET30=deferred` → `DeferredPosting` → `Bucket.append(12960)` (`Bucket.java:6–9`: throws `CapacityExceeded` if `booked + amount > ceiling`).

| Account | ceiling | booked (config) | booked + 12960 | > ceiling? |
|---------|---------|-----------------|----------------|-----------|
| A17 | 50000 | 38000 | **50960** | **YES** → throws |
| B29 | 50000 | 36000 | 48960 | no |
| C31 | 50000 | 37040 | **50000** | no (equal, not strictly greater) |

**D44**: region=US, terms=NET30 → key `posting.US.NET30=prepaid` → `PrepaidPosting.accept()` (`PrepaidPosting.java:3–5`) only rejects negative amounts; 12960 > 0 → passes silently. D44's exposure data in `exposure.properties` (booked=49000, ceiling=50000) is **never consulted** because prepaid posting ignores `ExposureBook`.

---

## Results

**`new Request("A17", 10, 1200, "EUR")`**
`Bucket.append` throws `CapacityExceeded`; `PreparedQuotes.save` catches it and throws `StoreConflict("ACCOUNT_CAPACITY", "A17")` (`PreparedQuotes.java:15–16`); `QuoteEndpoint.post` catches the `RuntimeException` and calls `responses.failure`; `ResponseMapper.java:11–13` matches `StoreConflict`:
> **409** `{"code":"ACCOUNT_CAPACITY","account":"A17"}`

**`new Request("B29", 10, 1200, "EUR")`**
Bucket allows 48960 ≤ 50000; `save` completes; `responses.created(draft)` (`ResponseMapper.java:6–8`):
> **201** `{"account":"B29","currency":"EUR","x":12960}`

**`new Request("C31", 10, 1200, "EUR")`**
Bucket allows exactly 50000 (not strictly greater than ceiling); `save` completes:
> **201** `{"account":"C31","currency":"EUR","x":12960}`

**`new Request("D44", 10, 1200, "EUR")`**
PrepaidPosting accepts the amount; `save` completes:
> **201** `{"account":"D44","currency":"EUR","x":12960}`