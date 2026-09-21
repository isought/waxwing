package vendor.rules;
public class Adjustment {
    public static int apply(int amount) {
        return amount < 100 ? amount + 7 : amount - 11;
    }
}
