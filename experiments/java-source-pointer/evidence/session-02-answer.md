## Results

**`Quote.quote(99)` → `109`**
**`Quote.quote(105)` → `97`**

### Implementation Evidence

**`Quote.java` line 4:**
```java
public static int quote(int amount) { return Adjustment.apply(amount) + 3; }
```

**`Adjustment.java` line 4** (`vendor-drop/2025-11/source/vendor/rules/Adjustment.java`):
```java
return amount < 100 ? amount + 7 : amount - 11;
```

### Trace

| Call | `Adjustment.apply(amount)` | Condition | Intermediate | `+ 3` | Result |
|---|---|---|---|---|---|
| `quote(99)` | `99 < 100` → true → `99 + 7` | below threshold | `106` | `+3` | **109** |
| `quote(105)` | `105 < 100` → false → `105 - 11` | at/above threshold | `94` | `+3` | **97** |

The threshold at `100` is the deciding factor: inputs below 100 receive a `+7` bonus, inputs ≥ 100 receive a `−11` penalty, and `Quote` adds a flat `+3` on top of either result.