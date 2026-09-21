import { validateRelationalModel, foreignKeyCardinality } from '../../knowledge/relational/index.mjs';
import { canonical, digest, fail } from '../../knowledge/shared/model.mjs';
import { units, wrap } from '../shared/model.mjs';

export const TABLE_HEADER = 66;
export const COLUMN_HEIGHT = 32;
const EPS = 0.1;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const boxShape = value => only(value, ['x', 'y', 'width', 'height']) && ['x', 'y', 'width', 'height'].every(key => finite(value[key])) && value.width > 0 && value.height > 0;
const pointShape = value => only(value, ['x', 'y']) && finite(value.x) && finite(value.y);
const contains = (a, b) => b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.width <= a.x + a.width + EPS && b.y + b.height <= a.y + a.height + EPS;
const overlaps = (a, b) => a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS && a.y < b.y + b.height - EPS && b.y < a.y + a.height - EPS;
const equalPoint = (a, b) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

export function tableColumns(model, tableRef) {
  return model.columns.filter(column => column.tableRef === tableRef).sort((a, b) => (a.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.ordinal ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
}

export function tableSize(model, table) {
  const columns = tableColumns(model, table.id);
  return { width: Math.max(340, Math.min(760, Math.max(units(table.label) * 10 + 40, ...columns.map(column => units(column.name) * 8 + Math.min(180, units(column.dataType ?? 'unknown') * 7) + 130)))), height: TABLE_HEADER + Math.max(1, columns.length) * COLUMN_HEIGHT + 12 };
}

export function relationalConnections(model) {
  return [...model.constraints.filter(record => record.kind === 'foreign').map(record => ({ ref: record.id, kind: 'foreign', from: record.tableRef, to: record.references.tableRef, fromColumns: record.columnRefs, toColumns: record.references.columnRefs, record, cardinality: foreignKeyCardinality(model, record) })),
    ...model.associations.map(record => ({ ref: record.id, kind: record.enforcement, from: record.from.tableRef, to: record.to.tableRef, fromColumns: record.from.columnRefs, toColumns: record.to.columnRefs, record, cardinality: { ...record.cardinality, reason: ['Explicitly recorded logical association; the database does not enforce this relationship.'] } }))].sort((a, b) => a.ref.localeCompare(b.ref));
}

export function connectionLabel(connection) {
  return [...wrap(connection.record.label, 36), `${connection.kind === 'foreign' ? 'FK' : connection.kind === 'application' ? 'Application' : 'Inferred'} · ${connection.record.evidence.status}${connection.fromColumns.length > 1 ? ` · ${connection.fromColumns.length} columns` : ''}`];
}

function pairs(connection) {
  if (connection.kind === 'foreign') return connection.fromColumns.map((ref, index) => ({ fromColumnRef: ref, toColumnRef: connection.toColumns[index] }));
  // Logical endpoints may use different numbers of fields. Keep the declared sets
  // in the inspector; a table-level route must not invent a positional pairing.
  return [{ fromColumnRef: connection.fromColumns.length === 1 ? connection.fromColumns[0] : null, toColumnRef: connection.toColumns.length === 1 ? connection.toColumns[0] : null }];
}

function portID(tableRef, columnRef, side) { return `${tableRef}::${columnRef ?? '__header'}::${side}`; }
function endpoint(table, columnRef, side) {
  const row = table.columns.find(column => column.ref === columnRef);
  return { x: table.box.x + (side === 'EAST' ? table.box.width : 0), y: row ? row.box.y + row.box.height / 2 : table.box.y + TABLE_HEADER / 2 };
}

export async function layoutRelational(model, options = {}) {
  const result = validateRelationalModel(model);
  if (!result.ok) fail('Relational JSON 1 is invalid.', result.diagnostics);
  if (!only(options, ['direction']) || !['RIGHT', 'DOWN'].includes(options.direction ?? 'RIGHT')) fail('Relational layout accepts only direction: RIGHT or DOWN.');
  const direction = options.direction ?? 'RIGHT';
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const connections = relationalConnections(model);
  const children = [...model.tables].sort((a, b) => a.id.localeCompare(b.id)).map(table => {
    const size = tableSize(model, table);
    const refs = [null, ...tableColumns(model, table.id).map(column => column.id)];
    return { id: table.id, ...size, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' }, ports: refs.flatMap((ref, index) => ['WEST', 'EAST'].map(side => ({ id: portID(table.id, ref, side), x: side === 'EAST' ? size.width : 0, y: index === 0 ? TABLE_HEADER / 2 : TABLE_HEADER + (index - 0.5) * COLUMN_HEIGHT, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } }))) };
  });
  const edges = connections.flatMap(connection => pairs(connection).map((pair, index) => {
    const lines = connectionLabel(connection);
    return { id: `${connection.ref}::${index}`, sources: [portID(connection.from, pair.fromColumnRef, 'EAST')], targets: [portID(connection.to, pair.toColumnRef, 'WEST')], ...(index ? {} : { labels: [{ id: `${connection.ref}::label`, text: lines.join('\n'), width: Math.max(...lines.map(units)) * 7.2 + 20, height: lines.length * 18 + 10, layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' } }] }) };
  }));
  const placed = await new ELK().layout({ id: '__relational', layoutOptions: {
    'elk.algorithm': 'layered', 'elk.direction': direction, 'elk.edgeRouting': 'ORTHOGONAL', 'elk.randomSeed': '1',
    'elk.spacing.nodeNode': '70', 'elk.layered.spacing.nodeNodeBetweenLayers': '150', 'elk.spacing.edgeNode': '26',
    'elk.spacing.edgeEdge': '18', 'elk.layered.spacing.edgeEdgeBetweenLayers': '18', 'elk.spacing.edgeLabel': '18',
    'elk.padding': '[top=40,left=40,bottom=40,right=40]',
  }, children, edges });
  const tables = placed.children.map(node => ({ ref: node.id, box: { x: node.x, y: node.y, width: node.width, height: node.height }, columns: tableColumns(model, node.id).map((column, index) => ({ ref: column.id, box: { x: node.x, y: node.y + TABLE_HEADER + index * COLUMN_HEIGHT, width: node.width, height: COLUMN_HEIGHT } })) }));
  const routes = connections.map(connection => {
    const members = pairs(connection).map((pair, index) => {
      const edge = placed.edges.find(item => item.id === `${connection.ref}::${index}`);
      if (edge.sections?.length !== 1) fail(`Unable to route relational connection "${connection.ref}".`);
      const section = edge.sections[0];
      return { ...pair, points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint] };
    });
    const label = placed.edges.find(item => item.id === `${connection.ref}::0`).labels[0];
    return { ref: connection.ref, kind: connection.kind, from: connection.from, to: connection.to, routes: members, label: { x: label.x, y: label.y, width: label.width, height: label.height } };
  });
  const output = { schemaVersion: 'relational-layout-1', diagramType: 'relational', model: structuredClone(model), modelDigest: digest(model), layout: { engine: 'elk-layered-relational', version: '1', direction }, canvas: { width: Math.max(420, placed.width), height: Math.max(220, placed.height) }, tables, edges: routes };
  const verified = validateRelationalLayout(output, { expectedModel: model });
  if (!verified.ok) fail('Generated relational geometry failed validation.', verified.diagnostics);
  return output;
}

export function validateRelationalLayout(drawing, { expectedModel } = {}) {
  const diagnostics = [];
  const add = (path, message) => diagnostics.push({ code: 'relational/layout-invalid', path, message });
  const shape = only(drawing, ['schemaVersion', 'diagramType', 'model', 'modelDigest', 'layout', 'canvas', 'tables', 'edges']) && drawing.schemaVersion === 'relational-layout-1' && drawing.diagramType === 'relational' && typeof drawing.modelDigest === 'string' && only(drawing.layout, ['engine', 'version', 'direction']) && drawing.layout.engine === 'elk-layered-relational' && drawing.layout.version === '1' && ['RIGHT', 'DOWN'].includes(drawing.layout.direction) && only(drawing.canvas, ['width', 'height']) && finite(drawing.canvas.width) && drawing.canvas.width > 0 && finite(drawing.canvas.height) && drawing.canvas.height > 0 && Array.isArray(drawing.tables) && Array.isArray(drawing.edges);
  if (!shape) return { ok: false, diagnostics: [{ code: 'relational/layout-schema', path: '', message: 'Expected a complete relational-layout-1 document with finite canvas geometry.' }] };
  const result = validateRelationalModel(drawing.model);
  if (!result.ok) return { ...result, diagnostics: result.diagnostics.map(item => ({ ...item, path: `/model${item.path}` })) };
  if (digest(drawing.model) !== drawing.modelDigest) add('/modelDigest', 'Embedded source does not match its digest.');
  if (expectedModel !== undefined && canonical(drawing.model) !== canonical(expectedModel)) add('/model', 'Embedded source differs from the complete supplied model.');
  if (drawing.tables.some(table => !only(table, ['ref', 'box', 'columns']) || typeof table.ref !== 'string' || !boxShape(table.box) || !Array.isArray(table.columns) || table.columns.some(column => !only(column, ['ref', 'box']) || typeof column.ref !== 'string' || !boxShape(column.box))) || drawing.edges.some(edge => !only(edge, ['ref', 'kind', 'from', 'to', 'routes', 'label']) || typeof edge.ref !== 'string' || !boxShape(edge.label) || !Array.isArray(edge.routes) || !edge.routes.length || edge.routes.some(route => !only(route, ['fromColumnRef', 'toColumnRef', 'points']) || ![route.fromColumnRef, route.toColumnRef].every(ref => ref === null || typeof ref === 'string') || !Array.isArray(route.points) || route.points.length < 2 || route.points.some(point => !pointShape(point))))) {
    add('', 'Malformed relational table, column, or connection geometry.');
    return { ok: false, diagnostics };
  }
  const coverage = (actual, expected, path) => {
    const refs = actual.map(item => item.ref);
    if (new Set(refs).size !== refs.length || refs.length !== expected.length || expected.some(ref => !refs.includes(ref))) add(path, 'Geometry must represent each source record exactly once without adding records.');
  };
  coverage(drawing.tables, drawing.model.tables.map(table => table.id), '/tables');
  const connections = relationalConnections(drawing.model);
  coverage(drawing.edges, connections.map(connection => connection.ref), '/edges');
  if (diagnostics.length) return { ok: false, diagnostics };
  const canvas = { x: 0, y: 0, ...drawing.canvas };
  for (const [index, table] of drawing.tables.entries()) {
    const path = `/tables/${index}`;
    const columns = tableColumns(drawing.model, table.ref);
    const size = tableSize(drawing.model, drawing.model.tables.find(item => item.id === table.ref));
    coverage(table.columns, columns.map(column => column.id), `${path}/columns`);
    if (!contains(canvas, table.box)) add(path, 'Table exceeds the canvas.');
    if (table.box.width < size.width - EPS || table.box.height < size.height - EPS) add(path, 'Table is too small for its column rows and header.');
    for (const [row, column] of table.columns.entries()) if (column.ref !== columns[row]?.id || !equalPoint(column.box, { x: table.box.x, y: table.box.y + TABLE_HEADER + row * COLUMN_HEIGHT }) || Math.abs(column.box.width - table.box.width) > EPS || column.box.height !== COLUMN_HEIGHT) add(`${path}/columns/${row}`, 'Column geometry must preserve the declared row order and table width.');
    for (const other of drawing.tables.slice(index + 1)) if (overlaps(table.box, other.box)) add(path, `Table overlaps "${other.ref}".`);
  }
  for (const [index, edge] of drawing.edges.entries()) {
    const path = `/edges/${index}`, connection = connections.find(item => item.ref === edge.ref);
    if (edge.from !== connection.from || edge.to !== connection.to || edge.kind !== connection.kind) add(path, 'Connection endpoints and enforcement must match the source.');
    const expectedPairs = pairs(connection);
    if (edge.routes.length !== expectedPairs.length) add(path, 'Connection must retain every declared column pair.');
    if (!contains(canvas, edge.label)) add(path, 'Connection label exceeds the canvas.');
    const lines = connectionLabel(connection);
    if (edge.label.width < Math.max(...lines.map(units)) * 7.2 + 20 - EPS || edge.label.height < lines.length * 18 + 10 - EPS) add(path, 'Connection label is too small for its text.');
    for (const table of drawing.tables) if (overlaps(edge.label, table.box)) add(path, `Connection label overlaps table "${table.ref}".`);
    for (const [pairIndex, route] of edge.routes.entries()) {
      const pair = expectedPairs[pairIndex];
      if (!pair || route.fromColumnRef !== pair.fromColumnRef || route.toColumnRef !== pair.toColumnRef) { add(path, 'Connection changed a declared column pair.'); continue; }
      const source = drawing.tables.find(table => table.ref === connection.from), target = drawing.tables.find(table => table.ref === connection.to);
      if (!equalPoint(route.points[0], endpoint(source, pair.fromColumnRef, 'EAST')) || !equalPoint(route.points.at(-1), endpoint(target, pair.toColumnRef, 'WEST'))) add(path, 'Connection must meet the correct table or column ports.');
      for (const [pointIndex, point] of route.points.entries()) {
        if (!contains(canvas, { ...point, width: 0, height: 0 })) add(path, 'Connection exceeds the canvas.');
        if (!pointIndex) continue;
        const previous = route.points[pointIndex - 1];
        if (Math.abs(point.x - previous.x) > EPS && Math.abs(point.y - previous.y) > EPS) add(path, 'Connection routes must be orthogonal.');
        for (const table of drawing.tables) {
          const box = table.box;
          const crossVertical = Math.abs(point.x - previous.x) < EPS && point.x > box.x + EPS && point.x < box.x + box.width - EPS && Math.max(point.y, previous.y) > box.y + EPS && Math.min(point.y, previous.y) < box.y + box.height - EPS;
          const crossHorizontal = Math.abs(point.y - previous.y) < EPS && point.y > box.y + EPS && point.y < box.y + box.height - EPS && Math.max(point.x, previous.x) > box.x + EPS && Math.min(point.x, previous.x) < box.x + box.width - EPS;
          if (crossVertical || crossHorizontal) add(path, `Connection crosses table "${table.ref}".`);
        }
      }
    }
  }
  return { ok: diagnostics.length === 0, diagnostics, summary: result.summary, warnings: [] };
}
