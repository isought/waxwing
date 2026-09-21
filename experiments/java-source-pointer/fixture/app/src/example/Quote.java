package example;
import vendor.rules.Adjustment;
public class Quote {
    public static int quote(int amount) { return Adjustment.apply(amount) + 3; }
}
