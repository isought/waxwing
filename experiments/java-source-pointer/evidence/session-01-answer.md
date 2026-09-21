## Results

**`Quote.quote(99)` → `109`**
**`Quote.quote(105)` → `97`**

---

### Evidence chain

**`Quote.java` line 4:**
```java
public static int quote(int amount) { return Adjustment.apply(amount) + 3; }
```

**`vendor-drop/2025-11/source/vendor/rules/Adjustment.java` line 4** (source for `lib/vendor-rules.jar` per `AGENTS.md`):
```java
public static int apply(int amount) {
    return amount < 100 ? amount + 7 : amount - 11;
}
```

### Arithmetic

| Call | `amount < 100`? | `Adjustment.apply` | `+ 3` | Result |
|---|---|---|---|---|
| `quote(99)` | true → `99 + 7 = 106` | 106 | +3 | **109** |
| `quote(105)` | false → `105 − 11 = 94` | 94 | +3 | **97** |

The threshold at 100 is the deciding factor: inputs below 100 get +7 (net +10 after Quote's +3), while inputs ≥ 100 get −11 (net −8 after Quote's +3).