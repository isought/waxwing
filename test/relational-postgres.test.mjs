import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { extractPostgresSchema, fromPostgresSnapshot, POSTGRES_CATALOG_SQL } from '../modules/analysis/relational/postgres.mjs';
import { validateRelationalModel } from '../modules/knowledge/relational/index.mjs';

const fixture = () => JSON.parse(fs.readFileSync(new URL('../examples/relational/postgres-catalog.json', import.meta.url), 'utf8'));

test('catalog normalization preserves ordered composite FK ownership, partial indexes and evidence scope', () => {
  const model = fromPostgresSnapshot(fixture(), { id: 'storage', title: 'Storage' });
  assert.equal(validateRelationalModel(model).ok, true);
  const owner = model.constraints.find(record => record.label === 'line_items_order_owner_fkey');
  assert.deepEqual(owner.references.columnRefs, ['pg:column:public/orders/customer_id', 'pg:column:public/orders/id']);
  assert.equal(model.indexes.find(record => record.label === 'customers_active_email_key').predicate, 'active');
  assert.match(model.indexes.find(record => record.label === 'orders_status_lower_idx').expression, /lower\(status\)/);
  assert.equal(model.tables[0].evidence.status, 'reported');
  assert.match(model.sources[0].description, /freshness is not established/);
  assert.deepEqual(model.associations, []);
});

test('catalog identities and model order are deterministic across source array order', () => {
  const before = fixture(), after = fixture();
  for (const name of ['tables', 'columns', 'constraints', 'indexes']) after[name].reverse();
  assert.deepEqual(fromPostgresSnapshot(before), fromPostgresSnapshot(after));
  after.columns.find(column => column.name === 'sku').name = 'product_code';
  const model = fromPostgresSnapshot(after);
  assert.ok(model.columns.some(column => column.id === 'pg:column:public/line_items/product_code'));
  assert.ok(!model.columns.some(column => column.id === 'pg:column:public/line_items/sku'));
});

test('generated expressions, identity modes and index definitions survive normalization distinctly', () => {
  const snapshot = fixture(), generated = snapshot.columns.find(column => column.name === 'sku');
  Object.assign(generated, { generated: 'stored', generationExpression: 'lower(product_name)', identity: null });
  Object.assign(snapshot.columns[0], { generated: null, generationExpression: null, identity: 'always' });
  Object.assign(snapshot.indexes[0], { definition: 'CREATE UNIQUE INDEX customers_active_email_key ON public.customers (email) INCLUDE (id) WHERE active', valid: false, ready: true });
  const model = fromPostgresSnapshot(snapshot);
  assert.equal(model.columns.find(column => column.name === 'sku').default, null);
  assert.equal(model.columns.find(column => column.name === 'sku').generationExpression, 'lower(product_name)');
  assert.equal(model.columns.find(column => column.id === 'pg:column:public/customers/id').identity, 'always');
  assert.match(model.indexes[0].definition, /INCLUDE/);
  assert.equal(model.indexes[0].unique, true);
  assert.equal(model.indexes[0].valid, false);
  generated.default = 'lower(product_name)';
  assert.throws(() => fromPostgresSnapshot(snapshot), /must not be recorded as a column default/);
});

test('indexes preserve repeated key columns accepted by PostgreSQL', () => {
  const snapshot = fixture();
  snapshot.indexes[0].columnNames = ['email', 'email'];
  const index = fromPostgresSnapshot(snapshot).indexes.find(record => record.label === 'customers_active_email_key');
  assert.deepEqual(index.columnRefs, ['pg:column:public/customers/email', 'pg:column:public/customers/email']);
});

test('schema selection retains only referenced external columns without inventing missing tables', () => {
  const snapshot = fixture();
  for (const collection of ['tables', 'columns', 'constraints', 'indexes']) for (const record of snapshot[collection]) {
    if ((record.table ?? record.name) === 'customers') record.schema = 'identity';
    if (record.referencedTable === 'customers') record.referencedSchema = 'identity';
  }
  const model = fromPostgresSnapshot(snapshot);
  assert.equal(model.tables.find(table => table.schema === 'identity').external, true);
  assert.deepEqual(model.columns.filter(column => column.tableRef === 'pg:table:identity/customers').map(column => column.name), ['id']);
  assert.ok(!model.constraints.some(record => record.label === 'customers_pkey'));
  assert.match(model.scope.coverage, /1 external/);
  snapshot.tables = snapshot.tables.filter(table => table.name !== 'customers');
  assert.throws(() => fromPostgresSnapshot(snapshot), /unknown table/);
});

test('extractor binds schema names and makes one read-only metadata call', async () => {
  let calls = 0;
  const snapshot = fixture(), schema = "public'); DROP TABLE orders; --";
  const returned = await extractPostgresSchema(async (sql, values) => {
    calls++;
    assert.equal(sql, POSTGRES_CATALOG_SQL);
    assert.deepEqual(values, [[schema]]);
    assert.ok(!sql.includes(schema));
    assert.match(sql, /ANY\(\$1::text\[\]\)/);
    return { rows: [{ snapshot }] };
  }, { schemas: [schema] });
  assert.equal(calls, 1);
  assert.deepEqual(returned, snapshot);
});

test('external catalog data is validated before it becomes a domain model', async () => {
  for (const change of [
    snapshot => { snapshot.schemaVersion = 'postgres'; },
    snapshot => { snapshot.columns[0].nullable = 'false'; },
    snapshot => { snapshot.columns[0].ordinal = 0; },
    snapshot => { snapshot.columns.push({ ...snapshot.columns[0] }); },
    snapshot => { snapshot.constraints.find(record => record.kind === 'foreign').referencedColumnNames = ['unknown']; },
    snapshot => { snapshot.constraints.find(record => record.kind === 'foreign').onDelete = 'drop'; },
    snapshot => { delete snapshot.indexes[0].predicate; },
  ]) {
    const snapshot = fixture(); change(snapshot);
    assert.throws(() => fromPostgresSnapshot(snapshot));
  }
  await assert.rejects(extractPostgresSchema(async () => ({ rows: [] })), /one PostgreSQL/);
  await assert.rejects(extractPostgresSchema(async () => ({ rows: [{ snapshot: fixture() }] }), { schemas: [] }), /at least one/);
});
