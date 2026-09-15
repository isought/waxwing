## Results

**`Quote.quote(99)` → `109`**
**`Quote.quote(105)` → `97`**

---

### Implementation Evidence

**`Quote.java` line 4:**
```java
public static int quote(int amount) { return Adjustment.apply(amount) + 3; }
```

**`vendor/rules/Adjustment.java` line 4:**
```java
return amount < 100 ? amount + 7 : amount - 11;
```

---

### Trace

| Call | `Adjustment.apply` branch | `apply` result | `+ 3` final |
|---|---|---|---|
| `quote(99)` | `99 < 100` → `99 + 7` | **106** | **109** |
| `quote(105)` | `105 ≥ 100` → `105 − 11` | **94** | **97** |

The ternary in `Adjustment.apply` splits at the threshold of 100: inputs below 100 get `+7`, inputs 100 or above get `−11`. `Quote.quote` then adds a fixed `+3` to whatever `apply` returns. 99 falls in the "below 100" branch, 105 in the "100 or above" branch.