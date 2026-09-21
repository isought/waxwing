import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { queryModel, modelRecords } from '../modules/knowledge/query/index.mjs';

const model = JSON.parse(fs.readFileSync(new URL('../examples/relational/model.json', import.meta.url), 'utf8'));

test('relational query inventories columns and distinguishes FK from logical neighbors', () => {
  const column = model.columns[0];
  const inspected = queryModel(model, 'inspect', column.id);
  assert.equal(inspected.results[0].kind, 'column');
  assert.deepEqual(inspected.results[0].record, column);
  assert.ok(inspected.sources.length);
  const found = queryModel(model, 'search', column.label, { kind: 'column' });
  assert.ok(found.results.some(record=>record.id===column.id));
  const header = modelRecords(model).find(record=>record.kind==='model').record;
  assert.equal(header.tables, undefined);
  assert.equal(header.columns, undefined);
  const foreign = model.constraints.find(record=>record.kind==='foreign');
  assert.ok(foreign);
  const outgoing = queryModel(model,'neighbors',foreign.tableRef,{direction:'outgoing',relation:'foreign'});
  assert.ok(outgoing.results.some(result=>result.relationship.id===foreign.id));
  assert.ok(outgoing.results.every(result=>result.relationship.kind==='foreign'));
  const byColumn = queryModel(model,'neighbors',foreign.columnRefs[0],{direction:'outgoing',relation:'foreign'});
  assert.deepEqual(byColumn.results.find(result=>result.relationship.id===foreign.id).to.columnRefs,foreign.references.columnRefs);
  assert.throws(()=>queryModel(model,'neighbors',foreign.tableRef,{relation:'reads'}),/foreign, application, or inferred/);
});
