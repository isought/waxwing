import java.nio.file.Path;
import quote.Bootstrap;
import quote.model.Request;
public class Probe {
 public static void main(String[] args) throws Exception {
  for (String account : new String[]{"A17", "B29", "C31", "D44"}) {
   var endpoint = Bootstrap.create(Path.of(args[0]));
   var response = endpoint.post(new Request(account, 10, 1200, "EUR"));
   System.out.println(account + " " + response.status() + " " + response.body());
  }
 }
}
