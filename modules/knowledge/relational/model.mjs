import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { schemaDiagnostics } from '../shared/diagnostics.mjs';

const schema = JSON.parse(fs.readFileSync(new URL('../../../schemas/relational-model.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: true, allErrors: true, verbose: true, allowUnionTypes: true });
const shape = ajv.compile(schema);
const collections = { tables: 'table', columns: 'column', constraints: 'constraint', indexes: 'index', associations: 'association' };

export function relationalRecords(model) {
  return Object.entries(collections).flatMap(([collection, kind]) => model[collection].map(record => ({ id: record.id, label: record.label, kind, record })));
}

function sameSet(a, b) { return a.length === b.length && a.every(value => b.includes(value)); }
function known(evidence) { return ['established', 'reported'].includes(evidence.status); }
function keysOf(model, tableRef) {
  return [
    ...model.constraints.filter(record => record.tableRef === tableRef && ['primary', 'unique'].includes(record.kind) && known(record.evidence)),
    ...model.indexes.filter(record => record.tableRef === tableRef && record.unique === true && (record.valid === undefined || record.valid === true) && (record.ready === undefined || record.ready === true) && record.predicate === null && record.expression === null && known(record.evidence)),
  ];
}

export function validateRelationalModel(model) {
  if (!shape(model)) return { ok: false, diagnostics: schemaDiagnostics(shape.errors, model, 'relational/schema', { root: schema, ajv }) };
  const diagnostics = [], entries = new Map([[model.id, { kind: 'model' }]]);
  const add = (path, message) => diagnostics.push({ code: 'relational/invalid', path, message });
  for (const source of model.sources) {
    if (entries.has(source.id)) add('/sources', `Duplicate ID "${source.id}".`);
    entries.set(source.id, { kind: 'source', record: source });
  }
  for (const [collection, kind] of Object.entries(collections)) for (const [i, record] of model[collection].entries()) {
    const path = `/${collection}/${i}`;
    if (entries.has(record.id)) add(`${path}/id`, `Duplicate ID "${record.id}".`);
    entries.set(record.id, { kind, record });
  }
  function endpoint(value, path) {
    if (entries.get(value.tableRef)?.kind !== 'table') add(`${path}/tableRef`, `Unknown table "${value.tableRef}".`);
    for (const [i, ref] of value.columnRefs.entries()) {
      const column = entries.get(ref);
      if (column?.kind !== 'column' || column.record.tableRef !== value.tableRef) add(`${path}/columnRefs/${i}`, `Column "${ref}" must belong to table "${value.tableRef}".`);
    }
  }
  const tableNames = new Set(), columnNames = new Set(), ordinals = new Set(), primaryKeys = new Set();
  for (const [collection] of Object.entries(collections)) for (const [i, record] of model[collection].entries()) {
    const path = `/${collection}/${i}`;
    for (const [j, ref] of record.evidence.sourceRefs.entries()) if (entries.get(ref)?.kind !== 'source') add(`${path}/evidence/sourceRefs/${j}`, `Unknown source "${ref}".`);
    if (known(record.evidence) && !record.evidence.sourceRefs.length) add(`${path}/evidence/sourceRefs`, 'Established and reported records require supporting source references.');
    if (collection === 'tables') {
      const name = JSON.stringify([record.schema, record.name]);
      if (tableNames.has(name)) add(path, 'A qualified table name must identify one table.');
      tableNames.add(name);
    } else if (collection === 'columns') {
      endpoint({ tableRef: record.tableRef, columnRefs: [] }, path);
      const name = JSON.stringify([record.tableRef, record.name]);
      if (columnNames.has(name)) add(path, 'A table cannot contain duplicate column names.');
      columnNames.add(name);
      if (record.ordinal !== null) {
        const ordinal = JSON.stringify([record.tableRef, record.ordinal]);
        if (ordinals.has(ordinal)) add(`${path}/ordinal`, 'A recorded column ordinal must be unique within its table.');
        ordinals.add(ordinal);
      }
      if (record.generated && record.default !== null) add(`${path}/default`, 'A generated expression must be recorded separately from a column default.');
      if (record.generated && record.identity) add(path, 'A column cannot be both an identity column and a generated expression column.');
    } else if (collection === 'associations') {
      endpoint(record.from, `${path}/from`); endpoint(record.to, `${path}/to`);
      if (record.enforcement === 'inferred' && record.evidence.status !== 'inferred') add(`${path}/evidence/status`, 'An inferred association must carry inferred evidence and a reason.');
    } else {
      endpoint(record, path);
      if (collection === 'constraints' && record.kind === 'primary') {
        if (primaryKeys.has(record.tableRef)) add(path, 'A table can have only one primary key.');
        primaryKeys.add(record.tableRef);
        if (known(record.evidence)) for (const ref of record.columnRefs) {
          const column = entries.get(ref);
          if (column?.kind === 'column' && known(column.record.evidence) && column.record.nullable === true) add(`${path}/columnRefs`, `Primary-key column "${ref}" cannot be nullable.`);
        }
      }
      if (collection === 'constraints' && record.kind === 'foreign') {
        endpoint(record.references, `${path}/references`);
        if (record.columnRefs.length !== record.references.columnRefs.length) add(`${path}/references/columnRefs`, 'A foreign key requires one ordered target column for each referencing column.');
        const target = entries.get(record.references.tableRef);
        if (target?.kind === 'table' && !target.record.external && known(record.evidence) && !keysOf(model, target.record.id).some(key => sameSet(key.columnRefs, record.references.columnRefs))) add(`${path}/references`, 'An internal foreign-key target must identify a recorded unconditional primary/unique key; partial or expression indexes do not prove that target key.');
      }
      if (collection === 'indexes' && !record.columnRefs.length && !record.expression) add(path, 'An index needs column references or its expression definition.');
    }
  }
  return { ok: !diagnostics.length, diagnostics, summary: Object.fromEntries(Object.keys(collections).map(name => [name, model[name].length])),
    limits: 'Checks structure, references, column ownership and recorded key consistency. Does not verify sources, database freshness, completeness, SQL expressions or application enforcement.' };
}

// End multiplicities: from = referencing rows per target; to = targets per referencing row.
// Facts describe rows at valid constraint boundaries, not transient deferred violations.
export function foreignKeyCardinality(model, constraintOrId) {
  const constraint = typeof constraintOrId === 'string' ? model.constraints.find(record => record.id === constraintOrId) : constraintOrId;
  if (!constraint || constraint.kind !== 'foreign') throw new Error('Cardinality requires a foreign-key constraint.');
  if (!known(constraint.evidence)) return { from: { min: 0, max: null }, to: { min: null, max: null }, reason: ['The foreign-key claim is not established or reported.'] };
  const sourceColumns = constraint.columnRefs.map(ref => model.columns.find(column => column.id === ref));
  const sourceKey = keysOf(model, constraint.tableRef).find(key => key.columnRefs.length && key.columnRefs.every(ref => constraint.columnRefs.includes(ref)));
  const allNotNull = sourceColumns.every(column => column?.nullable === false && known(column.evidence));
  if (!allNotNull && !['simple', 'full'].includes(constraint.match)) return { from: { min: 0, max: null }, to: { min: null, max: null }, reason: ['Partial or unknown match semantics with possibly-null columns do not establish exact-tuple relationship cardinality.'] };
  const anyNullable = sourceColumns.some(column => column?.nullable === true && known(column.evidence));
  const optional = constraint.match === 'simple' && anyNullable || constraint.match === 'full' && sourceColumns.every(column => column?.nullable === true && known(column.evidence));
  let minimum = null;
  if (constraint.validated === false) minimum = 0;
  else if (constraint.validated === true && (allNotNull || constraint.match === 'full' && sourceColumns.some(column => column?.nullable === false && known(column.evidence)))) minimum = 1;
  else if (optional) minimum = 0;
  const reason = ['Foreign keys never require a target row to be referenced.'];
  reason.push(sourceKey ? `Unconditional key "${sourceKey.id}" limits referencing rows to one per target.` : 'No recorded unconditional source key limits matching referencing rows to one.');
  if (minimum === 1) reason.push('Validated foreign key and nullability require a target at valid constraint boundaries.');
  else if (constraint.validated === false) reason.push('A NOT VALID foreign key may have unmatched existing rows.');
  else if (minimum === 0) reason.push('The recorded match mode and nullability permit an absent target.');
  else reason.push('Unknown validation, nullability or match mode leaves target optionality unknown.');
  return { from: { min: 0, max: sourceKey ? 1 : 'many' }, to: { min: minimum, max: 1 }, reason };
}
