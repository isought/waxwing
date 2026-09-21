import { validateRelationalModel } from '../../knowledge/relational/index.mjs';

// One statement gives a consistent catalog view. The caller owns connection,
// authorization and transaction policy; no PostgreSQL client dependency is needed.
export const POSTGRES_CATALOG_SQL = `
WITH selected AS (
  SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r','p','v','m')
), relations AS (
  SELECT oid FROM selected UNION
  SELECT con.confrelid FROM pg_catalog.pg_constraint con WHERE con.contype = 'f' AND con.conrelid IN (SELECT oid FROM selected)
)
SELECT jsonb_build_object(
 'schemaVersion', 'postgres-catalog-1', 'schemas', to_jsonb($1::text[]),
 'tables', COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'name',c.relname,'kind',CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materializedView' ELSE 'table' END
 ) ORDER BY n.nspname,c.relname) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.oid IN (SELECT oid FROM relations)), '[]'::jsonb),
 'columns', COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'table',c.relname,'name',a.attname,'dataType',pg_catalog.format_type(a.atttypid,a.atttypmod),
   'nullable',NOT (a.attnotnull OR t.typnotnull),
   'default',CASE WHEN a.attgenerated='' THEN pg_catalog.pg_get_expr(d.adbin,d.adrelid) ELSE NULL END,'ordinal',a.attnum,
   'generated',CASE a.attgenerated WHEN 's' THEN 'stored' WHEN 'v' THEN 'virtual' ELSE NULL END,
   'generationExpression',CASE WHEN a.attgenerated<>'' THEN pg_catalog.pg_get_expr(d.adbin,d.adrelid) ELSE NULL END,
   'identity',CASE a.attidentity WHEN 'a' THEN 'always' WHEN 'd' THEN 'byDefault' ELSE NULL END
 ) ORDER BY n.nspname,c.relname,a.attnum) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
 LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE c.oid IN (SELECT oid FROM relations) AND a.attnum>0 AND NOT a.attisdropped), '[]'::jsonb),
 'constraints', COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'table',c.relname,'name',con.conname,
   'kind',CASE con.contype WHEN 'p' THEN 'primary' WHEN 'u' THEN 'unique' WHEN 'f' THEN 'foreign' ELSE 'check' END,
   'columnNames',COALESCE((SELECT jsonb_agg(a.attname ORDER BY k.position) FROM unnest(con.conkey) WITH ORDINALITY k(number,position)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.number),'[]'::jsonb),
   'definition',pg_catalog.pg_get_constraintdef(con.oid,true)
 ) || CASE WHEN con.contype='f' THEN jsonb_build_object(
   'referencedSchema',tn.nspname,'referencedTable',tc.relname,
   'referencedColumnNames',COALESCE((SELECT jsonb_agg(a.attname ORDER BY k.position) FROM unnest(con.confkey) WITH ORDINALITY k(number,position)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=k.number),'[]'::jsonb),
   'onDelete',CASE con.confdeltype WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default' END,
   'onUpdate',CASE con.confupdtype WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default' END,
   'match',CASE con.confmatchtype WHEN 's' THEN 'simple' WHEN 'f' THEN 'full' WHEN 'p' THEN 'partial' END,
   'validated',con.convalidated,'deferrable',con.condeferrable
 ) ELSE '{}'::jsonb END ORDER BY n.nspname,c.relname,con.conname)
 FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_class tc ON tc.oid=con.confrelid
 LEFT JOIN pg_catalog.pg_namespace tn ON tn.oid=tc.relnamespace
 WHERE con.conrelid IN (SELECT oid FROM selected) AND con.contype IN ('p','u','f','c')), '[]'::jsonb),
 'indexes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'table',c.relname,'name',ic.relname,'unique',i.indisunique,'valid',i.indisvalid,'ready',i.indisready,
   'definition',pg_catalog.pg_get_indexdef(i.indexrelid),
   'columnNames',COALESCE((SELECT jsonb_agg(a.attname ORDER BY k.position) FROM unnest(i.indkey) WITH ORDINALITY k(number,position)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.number WHERE k.position<=i.indnkeyatts),'[]'::jsonb),
   'expression',CASE WHEN i.indexprs IS NULL THEN NULL ELSE pg_catalog.pg_get_indexdef(i.indexrelid) END,
   'predicate',pg_catalog.pg_get_expr(i.indpred,i.indrelid),'method',am.amname
 ) ORDER BY n.nspname,c.relname,ic.relname) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid
 JOIN pg_catalog.pg_am am ON am.oid=ic.relam WHERE i.indrelid IN (SELECT oid FROM selected)), '[]'::jsonb)
) AS snapshot`;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}
function string(value, label) {
  if (typeof value !== 'string' || !value.length) throw new Error(`${label} must be a non-empty string.`);
  return value;
}
function strings(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((item, i) => string(item, `${label}/${i}`));
}
function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((item, i) => object(item, `${label}/${i}`));
}
function nullable(value, type, label) {
  if (value !== null && typeof value !== type) throw new Error(`${label} must be ${type} or null.`);
  return value;
}
function qualified(schema, name) { return JSON.stringify([schema, name]); }
function identity(kind, ...parts) { return `pg:${kind}:${parts.map(encodeURIComponent).join('/')}`; }

export async function extractPostgresSchema(query, options = {}) {
  if (typeof query !== 'function') throw new Error('extractPostgresSchema requires a query function.');
  const schemas = strings(options.schemas ?? ['public'], 'schemas');
  if (!schemas.length) throw new Error('Choose at least one PostgreSQL schema.');
  const result = object(await query(POSTGRES_CATALOG_SQL, [schemas]), 'PostgreSQL result');
  const rows = array(result.rows, 'PostgreSQL rows');
  if (rows.length !== 1) throw new Error('Expected one PostgreSQL catalog snapshot row.');
  const snapshot = object(rows[0].snapshot, 'PostgreSQL snapshot');
  // Validate every returned field before exposing the snapshot to a consumer.
  fromPostgresSnapshot(snapshot, { id: 'catalog-validation', title: 'Catalog validation' });
  return snapshot;
}

export function fromPostgresSnapshot(input, options = {}) {
  const snapshot = object(input, 'snapshot');
  if (snapshot.schemaVersion !== 'postgres-catalog-1') throw new Error('Expected schemaVersion postgres-catalog-1.');
  const tables = array(snapshot.tables, 'tables'), columns = array(snapshot.columns, 'columns');
  const constraints = array(snapshot.constraints, 'constraints'), indexes = array(snapshot.indexes, 'indexes');
  const selectedSchemas = options.schemas ?? snapshot.schemas;
  const schemas = selectedSchemas === undefined ? null : strings(selectedSchemas, 'schemas');
  if (schemas && !schemas.length) throw new Error('Choose at least one PostgreSQL schema.');
  const source = options.source ?? { id: 'postgres-catalog', kind: 'database', locator: 'postgresql:catalog', description: 'PostgreSQL catalog snapshot; deployment freshness is not established by this file.' };
  const evidenceStatus = options.evidenceStatus ?? 'reported';
  if (!['established', 'reported'].includes(evidenceStatus)) throw new Error('Catalog evidenceStatus must be established or reported.');
  const evidence = () => ({ status: evidenceStatus, sourceRefs: [source.id] });
  const tableMap = new Map(), columnMap = new Map();
  for (const table of tables) {
    string(table.schema, 'table.schema'); string(table.name, 'table.name');
    if (!['table', 'view', 'materializedView'].includes(table.kind)) throw new Error('Unknown PostgreSQL relation kind.');
    const key = qualified(table.schema, table.name);
    if (tableMap.has(key)) throw new Error(`Duplicate catalog table ${key}.`);
    tableMap.set(key, table);
  }
  for (const column of columns) {
    string(column.schema, 'column.schema'); string(column.table, 'column.table'); string(column.name, 'column.name');
    if (!tableMap.has(qualified(column.schema, column.table))) throw new Error('Catalog column references an unknown table.');
    nullable(column.dataType, 'string', 'column.dataType'); nullable(column.nullable, 'boolean', 'column.nullable'); nullable(column.default, 'string', 'column.default');
    if (column.ordinal !== null && (!Number.isInteger(column.ordinal) || column.ordinal < 1)) throw new Error('column.ordinal must be a positive integer or null.');
    if (Object.hasOwn(column, 'generated') && ![null, 'stored', 'virtual'].includes(column.generated)) throw new Error('Unknown generated column mode.');
    if (Object.hasOwn(column, 'generationExpression')) nullable(column.generationExpression, 'string', 'column.generationExpression');
    if (Object.hasOwn(column, 'identity') && ![null, 'always', 'byDefault'].includes(column.identity)) throw new Error('Unknown identity column mode.');
    if (column.generated && column.default !== null) throw new Error('A generated expression must not be recorded as a column default.');
    const key = identity('column', column.schema, column.table, column.name);
    if (columnMap.has(key)) throw new Error(`Duplicate catalog column ${key}.`);
    columnMap.set(key, column);
  }
  const included = new Set(tables.filter(table => !schemas || schemas.includes(table.schema)).map(table => qualified(table.schema, table.name)));
  const external = new Set(), externalColumns = new Set();
  function columnRefs(schema, table, names) {
    return strings(names, 'columnNames').map(name => {
      const id = identity('column', schema, table, name);
      if (!columnMap.has(id)) throw new Error(`Missing catalog column ${schema}.${table}.${name}.`);
      return id;
    });
  }
  const selectedConstraints = [];
  for (const record of constraints) {
    string(record.schema, 'constraint.schema'); string(record.table, 'constraint.table'); string(record.name, 'constraint.name');
    if (!tableMap.has(qualified(record.schema, record.table))) throw new Error('Catalog constraint references an unknown table.');
    if (!['primary', 'unique', 'foreign', 'check'].includes(record.kind)) throw new Error('Unknown catalog constraint kind.');
    nullable(record.definition, 'string', 'constraint.definition');
    const refs = columnRefs(record.schema, record.table, record.columnNames);
    const value = { id: identity('constraint', record.schema, record.table, record.name), label: record.name, tableRef: identity('table', record.schema, record.table), kind: record.kind, columnRefs: refs, definition: record.definition, evidence: evidence() };
    if (record.kind === 'foreign') {
      string(record.referencedSchema, 'constraint.referencedSchema'); string(record.referencedTable, 'constraint.referencedTable');
      const targetKey = qualified(record.referencedSchema, record.referencedTable);
      if (!tableMap.has(targetKey)) throw new Error(`Missing referenced catalog table ${targetKey}.`);
      const targets = columnRefs(record.referencedSchema, record.referencedTable, record.referencedColumnNames);
      Object.assign(value, { references: { tableRef: identity('table', record.referencedSchema, record.referencedTable), columnRefs: targets }, onDelete: record.onDelete, onUpdate: record.onUpdate, match: record.match, validated: record.validated, deferrable: record.deferrable });
      if (included.has(qualified(record.schema, record.table)) && !included.has(targetKey)) {
        external.add(targetKey);
        for (const id of targets) externalColumns.add(id);
      }
    }
    if (included.has(qualified(record.schema, record.table))) selectedConstraints.push(value);
  }
  const selectedIndexes = [];
  for (const record of indexes) {
    string(record.schema, 'index.schema'); string(record.table, 'index.table'); string(record.name, 'index.name');
    if (!tableMap.has(qualified(record.schema, record.table))) throw new Error('Catalog index references an unknown table.');
    nullable(record.unique, 'boolean', 'index.unique'); nullable(record.expression, 'string', 'index.expression'); nullable(record.predicate, 'string', 'index.predicate'); nullable(record.method, 'string', 'index.method');
    for (const property of ['valid', 'ready']) if (Object.hasOwn(record, property)) nullable(record[property], 'boolean', `index.${property}`);
    if (Object.hasOwn(record, 'definition')) nullable(record.definition, 'string', 'index.definition');
    const refs = columnRefs(record.schema, record.table, record.columnNames);
    if (included.has(qualified(record.schema, record.table))) selectedIndexes.push({ id: identity('index', record.schema, record.table, record.name), label: record.name, tableRef: identity('table', record.schema, record.table), unique: record.unique, columnRefs: refs, expression: record.expression, predicate: record.predicate, method: record.method, evidence: evidence(), ...optionalFields(record, ['definition', 'valid', 'ready']) });
  }
  const model = {
    diagramType: 'relational', schemaVersion: 'relational-1', id: options.id ?? 'postgres-schema', title: options.title ?? 'PostgreSQL schema',
    scope: { environment: options.environment ?? 'Database environment unspecified', timeframe: options.timeframe ?? 'Snapshot time unspecified', coverage: `Catalog metadata for ${schemas ? schemas.join(', ') : 'snapshot schemas'}; ${external.size} external foreign-key target(s). Logical application references are not inferred.`, question: options.question ?? 'How is the recorded relational storage structured?' },
    sources: [source],
    tables: tables.filter(table => included.has(qualified(table.schema, table.name)) || external.has(qualified(table.schema, table.name))).map(table => ({ id: identity('table', table.schema, table.name), label: `${table.schema}.${table.name}`, name: table.name, schema: table.schema, kind: table.kind, external: external.has(qualified(table.schema, table.name)), evidence: evidence() })),
    columns: columns.filter(column => included.has(qualified(column.schema, column.table)) || externalColumns.has(identity('column', column.schema, column.table, column.name))).map(column => ({ id: identity('column', column.schema, column.table, column.name), label: `${column.schema}.${column.table}.${column.name}`, tableRef: identity('table', column.schema, column.table), name: column.name, dataType: column.dataType, nullable: column.nullable, default: column.default, ordinal: column.ordinal, evidence: evidence(), ...optionalFields(column, ['generated', 'generationExpression', 'identity']) })),
    constraints: selectedConstraints, indexes: selectedIndexes, associations: [],
  };
  for (const name of ['tables', 'columns', 'constraints', 'indexes']) model[name].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const validation = validateRelationalModel(model);
  if (!validation.ok) throw new Error(`Invalid PostgreSQL relational model: ${validation.diagnostics.map(item => item.message).join(' ')}`);
  return model;
}

function optionalFields(record, names) {
  return Object.fromEntries(names.filter(name => Object.hasOwn(record, name)).map(name => [name, record[name]]));
}
