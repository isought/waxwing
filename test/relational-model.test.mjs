import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validateRelationalModel, relationalRecords, foreignKeyCardinality } from '../modules/knowledge/relational/index.mjs';

const example = () => JSON.parse(fs.readFileSync(new URL('../examples/relational/model.json', import.meta.url), 'utf8'));
const ownerKey = model => model.constraints.find(record => record.label === 'line_items_order_owner_fkey');

test('relational inventory retains every inspectable record and complete source data', () => {
  const model = example();
  assert.equal(validateRelationalModel(model).ok, true);
  const records = relationalRecords(model);
  assert.deepEqual([...new Set(records.map(record => record.kind))], ['table', 'column', 'constraint', 'index', 'association']);
  assert.equal(records.length, 26);
  assert.equal(records.find(record => record.id === 'audit-order-reference').record.enforcement, 'application');
  assert.deepEqual(ownerKey(model).columnRefs, ['pg:column:public/line_items/customer_id', 'pg:column:public/line_items/order_id']);
  assert.deepEqual(ownerKey(model).references.columnRefs, ['pg:column:public/orders/customer_id', 'pg:column:public/orders/id']);
});

test('strict shape diagnostics reject unsupported claims and missing unknown markers', () => {
  const model = example();
  model.columns[0].dataType = null;
  assert.equal(validateRelationalModel(model).ok, true);
  delete model.columns[0].nullable;
  assert.ok(validateRelationalModel(model).diagnostics.some(record => record.path === '/columns/0/nullable'));
  model.columns[0].nullable = null;
  model.columns[0].evidence = { status: 'unknown', sourceRefs: [] };
  assert.ok(validateRelationalModel(model).diagnostics.some(record => record.path.includes('reason')));
  model.columns[0].evidence.reason = 'The source did not describe this column.';
  assert.equal(validateRelationalModel(model).ok, true);
  model.columns[0].evidence.status = 'disputed';
  assert.equal(validateRelationalModel(model).ok, false);
});

test('reference checks reject cross-table columns, duplicate identities and invented source evidence', () => {
  for (const change of [
    model => { ownerKey(model).columnRefs[0] = 'pg:column:public/orders/customer_id'; },
    model => { model.columns[0].id = model.tables[0].id; },
    model => { model.columns[0].evidence.sourceRefs = ['missing']; },
    model => { ownerKey(model).references.columnRefs.pop(); },
    model => { model.associations[0].to.tableRef = 'missing'; },
  ]) {
    const model = example(); change(model);
    assert.equal(validateRelationalModel(model).ok, false);
  }
});

test('primary key and column declarations cannot contradict their own physical storage facts', () => {
  for (const change of [
    model => { model.columns.find(column => column.id === 'pg:column:public/orders/id').nullable = true; },
    model => { model.constraints.push({ ...model.constraints.find(record => record.label === 'orders_pkey'), id: 'second-primary' }); },
    model => { model.columns.find(column => column.id === 'pg:column:public/orders/status').ordinal = 1; },
    model => { Object.assign(model.columns[0], { generated: 'stored', default: '2 + 2' }); },
  ]) {
    const model = example(); change(model);
    assert.equal(validateRelationalModel(model).ok, false);
  }
});

test('foreign keys require a recorded unconditional target key and preserve column correspondence', () => {
  const model = example();
  const foreign = ownerKey(model);
  model.constraints = model.constraints.filter(record => record.label !== 'orders_customer_id_id_key');
  assert.equal(validateRelationalModel(model).ok, false);
  model.indexes.push({ id: 'conditional-key', label: 'Conditional key', tableRef: foreign.references.tableRef, unique: true, columnRefs: [...foreign.references.columnRefs], expression: null, predicate: "status = 'active'", method: 'btree', evidence: model.tables[0].evidence });
  assert.equal(validateRelationalModel(model).ok, false);
  model.indexes.at(-1).predicate = null;
  assert.equal(validateRelationalModel(model).ok, true);
  foreign.references.columnRefs.reverse();
  assert.equal(validateRelationalModel(model).ok, true, 'Candidate key membership is a set; the FK ordered pairs remain recorded verbatim.');
});

test('composite FK cardinality distinguishes required, nullable, NOT VALID and unknown facts', () => {
  const model = example(), foreign = ownerKey(model);
  assert.deepEqual(foreignKeyCardinality(model, foreign).from, { min: 0, max: 'many' });
  assert.deepEqual(foreignKeyCardinality(model, foreign.id).to, { min: 1, max: 1 });
  model.columns.find(column => column.id === foreign.columnRefs[0]).nullable = true;
  assert.deepEqual(foreignKeyCardinality(model, foreign).to, { min: 0, max: 1 });
  foreign.match = 'full';
  assert.deepEqual(foreignKeyCardinality(model, foreign).to, { min: 1, max: 1 }, 'MATCH FULL plus one NOT NULL forbids an all-null or partially-null tuple.');
  foreign.validated = false;
  assert.deepEqual(foreignKeyCardinality(model, foreign).to, { min: 0, max: 1 });
  foreign.validated = null;
  assert.deepEqual(foreignKeyCardinality(model, foreign).to, { min: null, max: 1 });
  foreign.evidence = { status: 'unknown', sourceRefs: [], reason: 'Constraint presence is unknown.' };
  assert.deepEqual(foreignKeyCardinality(model, foreign).to, { min: null, max: null });
});

test('partial and expression indexes never establish one-to-one cardinality', () => {
  const model = example(), foreign = ownerKey(model);
  const index = { id: 'line-owner-key', label: 'Conditional source key', tableRef: foreign.tableRef, unique: true, columnRefs: [...foreign.columnRefs], expression: null, predicate: 'line_number = 1', method: 'btree', evidence: model.tables[0].evidence };
  model.indexes.push(index);
  assert.equal(foreignKeyCardinality(model, foreign).from.max, 'many');
  index.predicate = null; index.expression = 'lower(sku)';
  assert.equal(foreignKeyCardinality(model, foreign).from.max, 'many');
  index.expression = null;
  assert.equal(foreignKeyCardinality(model, foreign).from.max, 1);
  index.valid = false;
  assert.equal(foreignKeyCardinality(model, foreign).from.max, 'many');
  index.valid = true;
  index.ready = null;
  assert.equal(foreignKeyCardinality(model, foreign).from.max, 'many');
  index.ready = true;
  index.evidence = { status: 'inferred', sourceRefs: [], reason: 'Index is guessed.' };
  assert.equal(foreignKeyCardinality(model, foreign).from.max, 'many');
});

test('uncertain column evidence cannot establish required foreign-key targets', () => {
  const model = example(), foreign = ownerKey(model);
  const column = model.columns.find(record => record.id === foreign.columnRefs[0]);
  column.evidence = { status: 'inferred', sourceRefs: [], reason: 'The nullability is guessed.' };
  assert.equal(foreignKeyCardinality(model, foreign).to.min, null);
  column.evidence.status = 'unknown';
  assert.equal(foreignKeyCardinality(model, foreign).to.min, null);
  column.evidence = { status: 'established', sourceRefs: ['orders-schema'] };
  assert.equal(foreignKeyCardinality(model, foreign).to.min, 1);
});

test('partial and unknown matching cannot establish exact-tuple maxima for nullable foreign keys', () => {
  const model = example(), foreign = ownerKey(model);
  model.columns.find(column => column.id === foreign.columnRefs[0]).nullable = true;
  for (const match of ['partial', null]) {
    foreign.match = match;
    assert.deepEqual(foreignKeyCardinality(model, foreign).to, { min: null, max: null });
    assert.deepEqual(foreignKeyCardinality(model, foreign).from, { min: 0, max: null });
  }
});

test('inferred logical associations cannot masquerade as established database facts', () => {
  const model = example();
  model.associations[0].enforcement = 'inferred';
  assert.equal(validateRelationalModel(model).ok, false);
  model.associations[0].evidence.status = 'inferred';
  assert.equal(validateRelationalModel(model).ok, true);
  assert.throws(() => foreignKeyCardinality(model, model.associations[0]), /foreign-key constraint/);
});
