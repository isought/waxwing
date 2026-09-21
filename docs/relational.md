# Relational storage models

`relational-1` is a portable model family for database structure and qualified
logical associations. It complements architecture models: an architecture
`datastore` describes a system component; a relational model explains tables,
columns and constraints inside a storage boundary. A table can carry
`architectureRefs: [{ modelId, recordId, label }]` to record that connection.
These references are explicit mappings, not proof that another model exists.

The maintained example is [fictional order storage](../examples/relational/model.json).
It contains a composite foreign key that enforces order ownership, a partial
unique index, an expression index and an application-enforced JSON reference.
It contains no private application schema or customer data.

## Format and record identity

The root has `diagramType: "relational"`, `schemaVersion: "relational-1"`,
`id`, `title`, `scope`, `sources`, and five required record arrays:
`tables`, `columns`, `constraints`, `indexes`, and `associations`.
The scope records environment, timeframe, coverage and the question being answered
as strings. Coverage is deliberately partial; omission does not mean absence.
Sources have `id`, `kind`, `locator` and `description`.

Every inspectable record has a globally unique stable `id`, a readable `label`,
and `evidence: { status, sourceRefs, reason? }`. Descriptions are optional.
Supported statuses are `established`, `reported`, `inferred` and `unknown`.
Established/reported records need a source; inferred/unknown records need a
reason. This initial format does not support disputed alternatives; validation
rejects `disputed` instead of silently choosing an interpretation.

Evidence is a recorded claim, not verification performed by the validator.
In particular, a repository declaration and a database observation are different
sources. Use source kind and description to identify which one supports a record.
A file committed to Git does not establish what a deployment currently contains.

| Record | Required domain fields |
| --- | --- |
| Table | `name`, `schema`, `kind` (`table`, `view`, `materializedView`), `external` |
| Column | `tableRef`, `name`, `dataType`, `nullable`, `default`, `ordinal` |
| Constraint | `tableRef`, `kind` (`primary`, `unique`, `foreign`, `check`), ordered `columnRefs`, `definition` |
| Index | `tableRef`, `unique`, ordered key `columnRefs`, `expression`, `predicate`, `method` |
| Association | `from`, `to`, `enforcement` (`application`, `inferred`), `cardinality` |

Nullable scalar fields carry JSON `null` explicitly when not recorded or not
applicable. A null index predicate/expression denotes no recorded predicate/
expression; an uncertain index must have qualified evidence so it cannot be used
to establish an unconditional key. SQL expressions are opaque strings: Waxwing
does not evaluate defaults, index predicates or check expressions.

A foreign constraint additionally requires
`references: { tableRef, columnRefs }`, `onDelete`, `onUpdate`, `match`,
`validated`, and `deferrable`. Referential actions use PostgreSQL-style phrases
such as `no action`, `cascade`, and `set null`. Match is `simple`, `full`,
`partial`, or null. Column arrays retain their order: the first referencing
column corresponds to the first referenced column. Candidate-key membership
need not have the same order; the correspondence itself is never reordered.

Columns can additionally record `generated` (`stored`, `virtual`, or null),
`generationExpression`, and `identity` (`always`, `byDefault`, or null). A
generated expression belongs in `generationExpression`, not in `default`.
Indexes can carry their full SQL `definition` plus `valid` and `ready` flags.
The definition preserves details such as INCLUDE columns, operator classes,
collations and null ordering even where they are not separately modeled.

An association endpoint is `{ tableRef, columnRefs }`. Empty column arrays
allow a table-level logical association. Association multiplicities use
`{ from: { min, max }, to: { min, max } }`, where `from` counts referencing rows
per target, and `to` counts targets per referencing row. Minimum is `0`, `1`,
or null; maximum is `1`, `"many"`, or null. Null means unknown. An inferred
association must have inferred evidence and a reason. Application enforcement is
explicitly separate from database foreign-key enforcement. JSON paths or other
logical qualifications can be stated in its description/evidence reason.

## Validation and cardinality

```js
import {
  validateRelationalModel, relationalRecords, foreignKeyCardinality,
} from '@isought/waxwing/relational';

const result = validateRelationalModel(model);
if (!result.ok) console.error(result.diagnostics);
const records = relationalRecords(model);
// Each record is { id, label, kind, record }; the complete original record remains available.
const multiplicity = foreignKeyCardinality(model, foreignKeyId);
```

The validator checks the JSON shape, global IDs, source references, table/column
ownership, paired composite-key lengths and internal foreign-key target keys.
An internal target requires a recorded unconditional primary/unique key.
External targets are marked `external: true` with their referenced columns;
missing metadata is not repaired by inventing a target. Schema-only validation
does not prove that evidence is true or the scope complete.

Foreign-key cardinality is derived conservatively at valid constraint boundaries:

- A foreign key never requires a parent to have a child.
- A referencing-side unconditional key can limit matching children to one.
  Partial indexes, expression indexes, invalid indexes and inferred key claims
  cannot establish that limit.
- A validated foreign key plus recorded non-nullability can require a target.
  MATCH FULL permits absence only through an entirely null tuple. MATCH SIMPLE
  permits absence if any referencing column is null.
- A NOT VALID foreign key may have unmatched existing rows. Unknown column
  evidence, match mode or validation remains unknown when it affects the result.
  Partial/unknown matching with possibly-null columns does not establish
  exact-tuple multiplicities; PostgreSQL itself does not implement MATCH PARTIAL.
- Deferred constraints can temporarily be violated within a transaction; the
  result describes valid constraint boundaries, not every intermediate state.

`reason` explains the facts used. No SQL predicate theorem proving, row counts,
data profiling or inferred JSON foreign keys participate in this calculation.

## Bounded PostgreSQL acquisition

There is one maintained acquisition path: read a PostgreSQL catalog snapshot.
Waxwing does not execute repository migrations or arbitrary SQL supplied by an
agent, and does not claim that parsing a migration proves deployment state.
The extractor needs PostgreSQL 12 or newer for generated-column catalog fields;
the full statement has also been exercised against PostgreSQL 18.

```js
import {
  extractPostgresSchema, fromPostgresSnapshot,
} from '@isought/waxwing/relational';

// The application supplies its authorized connection. No pg dependency is bundled.
const snapshot = await extractPostgresSchema(
  (sql, parameters) => client.query(sql, parameters),
  { schemas: ['public'] },
);
const model = fromPostgresSnapshot(snapshot, {
  id: 'orders-storage',
  title: 'Order storage',
  source: {
    id: 'orders-catalog', kind: 'database', locator: 'orders:catalog',
    description: 'Catalog observed through the authorized orders connection.',
  },
  environment: 'Orders development database',
  timeframe: 'Observation recorded by the caller',
  evidenceStatus: 'established',
});
```

The query is one read-only `pg_catalog` SELECT. Schema names are parameters,
never SQL text interpolation. The caller owns connection credentials, permissions
and transaction policy; a surrounding repeatable-read/read-only transaction is
appropriate when capturing other related metadata at the same time. No table
row values are read. The extractor validates the result and returns a raw
`postgres-catalog-1` snapshot, suitable for saving as JSON. The converter returns
a validated `relational-1` model.

The [public snapshot fixture](../examples/relational/postgres-catalog.json)
documents the normalized shape. Its arrays are `tables`, `columns`, `constraints`,
and `indexes`. Tables use schema/name; columns and constraints/indexes use
schema/table/name. Constraint columns use `columnNames`; foreign targets use
`referencedSchema`, `referencedTable`, and `referencedColumnNames`. Model fields
otherwise retain their names. An optional `schemas` array records selection.
Table schema names are non-empty strings in a catalog snapshot.

Schema selection includes foreign-key targets outside the selected schemas as
external stubs with only referenced columns. Their unrelated columns, indexes
and outgoing relationships are excluded from the model. Snapshot rows must supply
those actual target names and columns; missing endpoint metadata fails clearly.

The converter defaults to `reported` evidence and a source description that says
deployment freshness is not established by the file. It adds no clock timestamps.
IDs derive from encoded schema/table/record names, and output records are sorted
independently of catalog row order. A rename consequently appears as removal and
addition; this version does not guess rename mappings. Repeated snapshots can be
reviewed by stable identity without false changes caused by array ordering.

Acquisition includes tables, partitioned tables, views, materialized views,
columns, primary/unique/foreign/check constraints, and indexes. Generated columns
and identity modes are distinct from defaults. Index predicates, expression
definitions and invalid index state are preserved. Inheritance/partition topology,
view definitions/dependencies, triggers, functions, grants, row-level-security
policies, exclusion constraints and enum/domain definitions are outside this
first scope. Partition child relations may appear as tables with their own
catalog constraints. The format does not infer application relationships from
names or data types, and catalog coverage is never a statement of all logical
business concepts represented by the physical storage.
