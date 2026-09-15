### Results

**`Quote.quote(99)` → `109`**
**`Quote.quote(105)` → `97`**

---

### Evidence

**`Quote.java` (line 4):**
```java
public static int quote(int amount) { return Adjustment.apply(amount) + 3; }
```
It delegates to `Adjustment.apply(amount)` and adds 3.

**`Adjustment.java` (vendor-drop/2025-11/source/, line 4):**
```java
return amount < 100 ? amount + 7 : amount - 11;
```

**Tracing the calls:**

| Input | `amount < 100`? | `Adjustment.apply` returns | `+ 3` → final |
|-------|----------------|---------------------------|---------------|
| 99 | true (99 < 100) | 99 + 7 = **106** | 106 + 3 = **109** |
| 105 | false | 105 − 11 = **94** | 94 + 3 = **97** |

**Why:** `Adjustment.apply` applies a +7 bonus for amounts below 100 and an −11 penalty for 100 or above. `Quote.quote` then adds a flat +3 to either result.