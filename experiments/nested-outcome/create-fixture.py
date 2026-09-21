"""Create an executable Java fixture for baseline-only outcome tracing."""
from pathlib import Path
import json
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=False)
files = {
'src/quote/model/Request.java': '''package quote.model;
public record Request(String account, int quantity, long unitPrice, String currency) {}
''',
'src/quote/model/Draft.java': '''package quote.model;
public final class Draft {
    private final Request request;
    private long subtotal, discount, delivery, tax, total;
    public Draft(Request request) { this.request = request; }
    public Request request() { return request; }
    public long subtotal() { return subtotal; }
    public void subtotal(long value) { subtotal = value; }
    public long discount() { return discount; }
    public void discount(long value) { discount = value; }
    public long delivery() { return delivery; }
    public void delivery(long value) { delivery = value; }
    public long tax() { return tax; }
    public void tax(long value) { tax = value; }
    public long total() { return total; }
    public void total(long value) { total = value; }
}
''',
'src/quote/api/Response.java': '''package quote.api;
public record Response(int status, String body) {}
''',
'src/quote/api/QuoteEndpoint.java': '''package quote.api;
import quote.model.Request;
import quote.service.QuoteService;
public final class QuoteEndpoint {
    private final QuoteService service;
    private final ResponseMapper responses;
    public QuoteEndpoint(QuoteService service, ResponseMapper responses) {
        this.service = service;
        this.responses = responses;
    }
    public Response post(Request request) {
        try {
            return responses.created(service.prepare(request));
        } catch (RuntimeException error) {
            return responses.failure(error);
        }
    }
}
''',
'src/quote/api/ResponseMapper.java': '''package quote.api;
import quote.model.Draft;
import quote.store.StoreConflict;
public final class ResponseMapper {
    public Response created(Draft draft) {
        return new Response(201, "{\\"account\\":\\"" + draft.request().account()
            + "\\",\\"currency\\":\\"" + draft.request().currency()
            + "\\",\\"x\\":" + draft.total() + "}");
    }
    public Response failure(RuntimeException error) {
        if (error instanceof StoreConflict conflict) {
            return new Response(409, "{\\"code\\":\\"" + conflict.code()
                + "\\",\\"account\\":\\"" + conflict.account() + "\\"}");
        }
        if (error instanceof IllegalArgumentException) {
            return new Response(400, "{\\"code\\":\\"INVALID_REQUEST\\"}");
        }
        return new Response(500, "{\\"code\\":\\"INTERNAL_ERROR\\"}");
    }
}
''',
'src/quote/service/QuoteService.java': '''package quote.service;
import quote.model.Draft;
import quote.model.Request;
import quote.flow.Route;
public final class QuoteService {
    private final Route route;
    public QuoteService(Route route) { this.route = route; }
    public Draft prepare(Request request) {
        if (request.quantity() <= 0 || request.unitPrice() < 0) {
            throw new IllegalArgumentException("quantity and unit price");
        }
        Draft draft = new Draft(request);
        route.apply(draft);
        return draft;
    }
}
''',
'src/quote/flow/Stage.java': '''package quote.flow;
import quote.model.Draft;
public interface Stage { void apply(Draft draft); }
''',
'src/quote/flow/Route.java': '''package quote.flow;
import java.util.List;
import quote.model.Draft;
public final class Route {
    private final List<Stage> stages;
    public Route(List<Stage> stages) { this.stages = List.copyOf(stages); }
    public void apply(Draft draft) {
        for (Stage stage : stages) { stage.apply(draft); }
    }
}
''',
'src/quote/flow/RouteFactory.java': '''package quote.flow;
import java.util.Arrays;
import java.util.Map;
import java.util.Properties;
public final class RouteFactory {
    public Route build(Properties configuration, Map<String, Stage> available) {
        return new Route(Arrays.stream(configuration.getProperty("quote.route").split(","))
            .map(String::trim)
            .map(name -> {
                Stage stage = available.get(name);
                if (stage == null) { throw new IllegalArgumentException("Unknown stage: " + name); }
                return stage;
            }).toList());
    }
}
''',
'src/quote/pricing/Amounts.java': '''package quote.pricing;
import quote.flow.Stage;
import quote.model.Draft;
public final class Amounts implements Stage {
    public void apply(Draft draft) {
        draft.subtotal(Math.multiplyExact(draft.request().quantity(), draft.request().unitPrice()));
    }
}
''',
'src/quote/pricing/Discounts.java': '''package quote.pricing;
import quote.flow.Stage;
import quote.model.Draft;
public final class Discounts implements Stage {
    private final long threshold;
    private final int basisPoints;
    public Discounts(long threshold, int basisPoints) {
        this.threshold = threshold;
        this.basisPoints = basisPoints;
    }
    public void apply(Draft draft) {
        long discount = draft.subtotal() >= threshold
            ? Math.multiplyExact(draft.subtotal(), basisPoints) / 10000 : 0;
        draft.discount(discount);
    }
}
''',
'src/quote/pricing/Delivery.java': '''package quote.pricing;
import quote.flow.Stage;
import quote.model.Draft;
public final class Delivery implements Stage {
    private final long freeFrom, fee;
    public Delivery(long freeFrom, long fee) { this.freeFrom = freeFrom; this.fee = fee; }
    public void apply(Draft draft) {
        draft.delivery(draft.subtotal() - draft.discount() >= freeFrom ? 0 : fee);
    }
}
''',
'src/quote/pricing/TaxTable.java': '''package quote.pricing;
import java.util.Properties;
public final class TaxTable {
    private final Properties configuration;
    public TaxTable(Properties configuration) { this.configuration = configuration; }
    public long tax(String currency, long base) {
        int rate = Integer.parseInt(configuration.getProperty("tax." + currency, "0"));
        return Math.multiplyExact(base, rate) / 10000;
    }
}
''',
'src/quote/pricing/Totals.java': '''package quote.pricing;
import quote.flow.Stage;
import quote.model.Draft;
public final class Totals implements Stage {
    private final TaxTable taxes;
    public Totals(TaxTable taxes) { this.taxes = taxes; }
    public void apply(Draft draft) {
        long net = draft.subtotal() - draft.discount() + draft.delivery();
        draft.tax(taxes.tax(draft.request().currency(), net));
        draft.total(Math.addExact(net, draft.tax()));
    }
}
''',
'src/quote/store/QuoteStore.java': '''package quote.store;
import quote.model.Draft;
public interface QuoteStore { void save(Draft draft); }
''',
'src/quote/store/Recording.java': '''package quote.store;
import quote.flow.Stage;
import quote.model.Draft;
public final class Recording implements Stage {
    private final QuoteStore store;
    public Recording(QuoteStore store) { this.store = store; }
    public void apply(Draft draft) { store.save(draft); }
}
''',
'src/quote/store/PreparedQuotes.java': '''package quote.store;
import java.util.HashMap;
import java.util.Map;
import quote.model.Draft;
import quote.accounts.Allocations;
import quote.accounts.CapacityExceeded;
public final class PreparedQuotes implements QuoteStore {
    private final Allocations allocations;
    private final Map<String, Draft> drafts = new HashMap<>();
    public PreparedQuotes(Allocations allocations) { this.allocations = allocations; }
    public void save(Draft draft) {
        try {
            allocations.record(draft.request().account(), draft.total());
            drafts.put(draft.request().account(), draft);
        } catch (CapacityExceeded failure) {
            throw new StoreConflict("ACCOUNT_CAPACITY", draft.request().account(), failure);
        }
    }
}
''',
'src/quote/store/StoreConflict.java': '''package quote.store;
public final class StoreConflict extends RuntimeException {
    private final String code, account;
    public StoreConflict(String code, String account, Throwable cause) {
        super(code, cause);
        this.code = code;
        this.account = account;
    }
    public String code() { return code; }
    public String account() { return account; }
}
''',
'src/quote/accounts/Account.java': '''package quote.accounts;
public record Account(String id, String region, String terms) {}
''',
'src/quote/accounts/AccountDirectory.java': '''package quote.accounts;
import java.util.Properties;
public final class AccountDirectory {
    private final Properties data;
    public AccountDirectory(Properties data) { this.data = data; }
    public Account get(String id) {
        String region = data.getProperty(id + ".region");
        if (region == null) { throw new IllegalArgumentException("Unknown account"); }
        return new Account(id, region, data.getProperty(id + ".terms", "PREPAID"));
    }
}
''',
'src/quote/accounts/Posting.java': '''package quote.accounts;
public interface Posting { void accept(Account account, long amount); }
''',
'src/quote/accounts/PrepaidPosting.java': '''package quote.accounts;
public final class PrepaidPosting implements Posting {
    public void accept(Account account, long amount) {
        if (amount < 0) { throw new IllegalArgumentException("Negative amount"); }
    }
}
''',
'src/quote/accounts/DeferredPosting.java': '''package quote.accounts;
public final class DeferredPosting implements Posting {
    private final ExposureBook book;
    public DeferredPosting(ExposureBook book) { this.book = book; }
    public void accept(Account account, long amount) {
        book.forAccount(account.id()).append(amount);
    }
}
''',
'src/quote/accounts/PostingRegistry.java': '''package quote.accounts;
import java.util.Map;
import java.util.Properties;
public final class PostingRegistry {
    private final Properties configuration;
    private final Map<String, Posting> postings;
    public PostingRegistry(Properties configuration, Map<String, Posting> postings) {
        this.configuration = configuration;
        this.postings = postings;
    }
    public Posting select(Account account) {
        String key = "posting." + account.region() + "." + account.terms();
        String name = configuration.getProperty(key, configuration.getProperty("posting.default"));
        Posting selected = postings.get(name);
        if (selected == null) { throw new IllegalArgumentException("Unknown posting: " + name); }
        return selected;
    }
}
''',
'src/quote/accounts/Allocations.java': '''package quote.accounts;
public final class Allocations {
    private final AccountDirectory accounts;
    private final PostingRegistry postings;
    public Allocations(AccountDirectory accounts, PostingRegistry postings) {
        this.accounts = accounts;
        this.postings = postings;
    }
    public void record(String accountId, long amount) {
        Account account = accounts.get(accountId);
        postings.select(account).accept(account, amount);
    }
}
''',
'src/quote/accounts/ExposureBook.java': '''package quote.accounts;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;
public final class ExposureBook {
    private final Properties data;
    private final Map<String, Bucket> buckets = new HashMap<>();
    public ExposureBook(Properties data) { this.data = data; }
    public Bucket forAccount(String account) {
        return buckets.computeIfAbsent(account, id -> new Bucket(
            Long.parseLong(data.getProperty(id + ".ceiling", "0")),
            Long.parseLong(data.getProperty(id + ".booked", "0"))));
    }
}
''',
'src/quote/accounts/Bucket.java': '''package quote.accounts;
public final class Bucket {
    private final long ceiling;
    private long booked;
    public Bucket(long ceiling, long booked) { this.ceiling = ceiling; this.booked = booked; }
    public synchronized void append(long amount) {
        long next = Math.addExact(booked, amount);
        if (next > ceiling) { throw new CapacityExceeded(); }
        booked = next;
    }
}
''',
'src/quote/accounts/CapacityExceeded.java': '''package quote.accounts;
public final class CapacityExceeded extends RuntimeException {}
''',
'src/quote/Bootstrap.java': '''package quote;
import java.io.IOException;
import java.io.Reader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Properties;
import quote.accounts.*;
import quote.api.*;
import quote.flow.*;
import quote.pricing.*;
import quote.service.QuoteService;
import quote.store.*;
public final class Bootstrap {
    private static Properties load(Path path) throws IOException {
        Properties properties = new Properties();
        try (Reader reader = Files.newBufferedReader(path)) { properties.load(reader); }
        return properties;
    }
    public static QuoteEndpoint create(Path root) throws IOException {
        Properties app = load(root.resolve("config/application.properties"));
        Properties accounts = load(root.resolve("config/accounts.properties"));
        Properties exposure = load(root.resolve("config/exposure.properties"));
        PostingRegistry postings = new PostingRegistry(app, Map.of(
            "prepaid", new PrepaidPosting(),
            "deferred", new DeferredPosting(new ExposureBook(exposure))));
        Allocations allocations = new Allocations(new AccountDirectory(accounts), postings);
        QuoteStore store = new PreparedQuotes(allocations);
        Map<String, Stage> stages = Map.of(
            "amounts", new Amounts(),
            "discounts", new Discounts(Long.parseLong(app.getProperty("discount.threshold")),
                Integer.parseInt(app.getProperty("discount.basisPoints"))),
            "delivery", new Delivery(Long.parseLong(app.getProperty("delivery.freeFrom")),
                Long.parseLong(app.getProperty("delivery.fee"))),
            "totals", new Totals(new TaxTable(app)),
            "recording", new Recording(store));
        Route route = new RouteFactory().build(app, stages);
        return new QuoteEndpoint(new QuoteService(route), new ResponseMapper());
    }
}
''',
'config/application.properties': '''quote.route=amounts,discounts,delivery,totals,recording
discount.threshold=10000
discount.basisPoints=1000
delivery.freeFrom=10000
delivery.fee=500
tax.EUR=2000
tax.USD=0
posting.default=prepaid
posting.EU.NET30=deferred
posting.US.NET30=prepaid
''',
'config/accounts.properties': '''A17.region=EU
A17.terms=NET30
B29.region=EU
B29.terms=NET30
C31.region=EU
C31.terms=NET30
D44.region=US
D44.terms=NET30
''',
'config/exposure.properties': '''A17.ceiling=50000
A17.booked=38000
B29.ceiling=50000
B29.booked=36000
C31.ceiling=50000
C31.booked=37040
D44.ceiling=50000
D44.booked=49000
''',
'README.md': '''# Quote service

Java 21. Monetary amounts are integer minor units. Configuration is loaded from
the config directory. No external services are needed.

Build: `mkdir -p build/classes && javac -d build/classes $(find src -name '*.java')`
''',
}
for name, content in files.items():
    p = root / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
subprocess.run(['git', 'init', '--quiet'], cwd=root, check=True)
subprocess.run(['git', 'add', '.'], cwd=root, check=True)
subprocess.run(['git', '-c', 'user.name=Experiment Fixture', '-c', 'user.email=fixture@example.invalid',
                '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Create layered quote fixture'], cwd=root, check=True)
print(json.dumps({'root':str(root), 'java_files':sum(n.endswith('.java') for n in files),
                  'java_lines':sum(len(s.splitlines()) for n,s in files.items() if n.endswith('.java')),
                  'revision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()}))
