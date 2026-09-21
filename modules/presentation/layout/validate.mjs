import fs from 'node:fs';
import { schemaDiagnostics, prefixDiagnostics } from '../../knowledge/shared/diagnostics.mjs';
import { validateWorkflows } from '../workflow/validate.mjs';
import { validateSequenceLayout } from '../sequence/layout.mjs';
import { validateRelationalLayout } from '../relational/layout.mjs';
import { inspectReadability } from './readability.mjs';
import { projectGraph } from '../../knowledge/architecture/graphs.mjs';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateModel } from '../../knowledge/architecture/model.mjs';
import { canonical, digest } from '../../knowledge/shared/model.mjs';
import { frameMemberships, visibleGroups, edgeLines, units, wrap } from '../shared/model.mjs';

const readSchema = (name) => JSON.parse(fs.readFileSync(new URL(`../../../schemas/${name}`, import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: true, allErrors: true, verbose: true, allowUnionTypes: true });
ajv.addSchema(readSchema('system-model.schema.json'), 'system-model.schema.json');
const validateShape = ajv.compile(readSchema('layout.schema.json'));
const EPS = 0.01;
const contains = (outer, inner) => inner.x >= outer.x - EPS && inner.y >= outer.y - EPS && inner.x + inner.width <= outer.x + outer.width + EPS && inner.y + inner.height <= outer.y + outer.height + EPS;
const overlaps = (a, b) => a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS && a.y < b.y + b.height - EPS && b.y < a.y + a.height - EPS;
const onBorder = (point, box) => contains(box, { ...point, width: 0, height: 0 }) &&
  [Math.abs(point.x - box.x), Math.abs(point.x - box.x - box.width), Math.abs(point.y - box.y), Math.abs(point.y - box.y - box.height)].some((delta) => delta <= EPS);
function cutsBox(a, b, box) {
  if (Math.abs(a.x - b.x) < EPS) return a.x > box.x + EPS && a.x < box.x + box.width - EPS && Math.max(a.y, b.y) > box.y + EPS && Math.min(a.y, b.y) < box.y + box.height - EPS;
  if (Math.abs(a.y - b.y) < EPS) return a.y > box.y + EPS && a.y < box.y + box.height - EPS && Math.max(a.x, b.x) > box.x + EPS && Math.min(a.x, b.x) < box.x + box.width - EPS;
  return false;
}

export function validateLayout(document, { expectedModel } = {}) {
  if (document?.diagramType === 'relational') return validateRelationalLayout(document, { expectedModel });
  if (document?.diagramType === 'sequence') return validateSequenceLayout(document, { expectedModel });
  if (!validateShape(document)) return { ok: false, diagnostics: schemaDiagnostics(validateShape.errors, document, 'layout/schema', {root:validateShape.schema, ajv}) };
  const diagnostics = [];
  const add = (code, path, message) => diagnostics.push({ code, path, message });
  const modelResult = validateModel(document.model);
  if (!modelResult.ok) return {...modelResult, diagnostics:prefixDiagnostics(modelResult.diagnostics, '/model')};
  if (digest(document.model) !== document.modelDigest) add('source/digest', '/modelDigest', 'The embedded model does not match its recorded digest.');
  if (expectedModel && canonical(document.model) !== canonical(expectedModel)) add('source/changed', '/model', 'JSON 2 changed the supplied JSON 1.');
  if (document.graphs) {
    diagnostics.push(...validateWorkflows(document));
    const seen = new Set();
    document.graphs.forEach((geometry, i) => {
      const path = `/graphs/${i}`;
      if (seen.has(geometry.ref) || !document.model.graphs.some((graph) => graph.id === geometry.ref)) {
        add('layout/coverage', path, 'Graph geometry is duplicated or not authorized by JSON 1.'); return;
      }
      seen.add(geometry.ref);
      const model = projectGraph(document.model, geometry.ref);
      const { ref, ...drawing } = geometry;
      const result = validateLayout({ schemaVersion: '0.2-draft', model, modelDigest: digest(model), ...drawing });
      diagnostics.push(...prefixDiagnostics(result.diagnostics, path));
    });
    for (const graph of document.model.graphs) if (!seen.has(graph.id)) add('layout/coverage', '/graphs', `Missing graph "${graph.id}".`);
    const views = [...document.graphs, ...(document.workflows ?? []).map((w) => ({ ...w, groups: [], edges: w.edges.map((e) => ({ ...e, from: e.fromAppearanceRef, to: e.toAppearanceRef })) }))];
    return { ok: diagnostics.length === 0, diagnostics, summary: modelResult.summary, warnings: diagnostics.length ? [] : views.flatMap((view) => inspectReadability(view, view.ref)) };
  }
  const perspective = document.layout.groupingPerspectiveRef;
  if (perspective !== null && !document.model.perspectives.some((item) => item.id === perspective)) add('layout/perspective', '/layout/groupingPerspectiveRef', 'Grouping must name a model perspective.');

  function coverage(items, expected, path) {
    const seen = new Set();
    for (const [index, item] of items.entries()) {
      if (seen.has(item.ref) || !expected.has(item.ref)) add('layout/coverage', `${path}/${index}/ref`, 'An element is duplicated or not authorized by the source model.');
      seen.add(item.ref);
    }
    for (const ref of expected) if (!seen.has(ref)) add('layout/coverage', path, `Missing representation of "${ref}".`);
  }
  coverage(document.nodes, new Set(document.model.entities.map((item) => item.id)), '/nodes');
  coverage(document.edges, new Set(document.model.relationships.map((item) => item.id)), '/edges');
  coverage(document.groups, visibleGroups(document.model, perspective), '/groups');
  if (diagnostics.length) return { ok: false, diagnostics };

  const canvas = { x: 0, y: 0, ...document.canvas };
  const nodes = new Map(document.nodes.map((item) => [item.ref, item.box]));
  if (document.layout.readingAnchorRef !== undefined) {
    const anchor = nodes.get(document.layout.readingAnchorRef);
    const axis = document.layout.direction === 'DOWN' ? 'y' : 'x';
    if (!anchor) add('layout/reading-anchor', '/layout/readingAnchorRef', 'Reading anchor must name a component shown in this graph.');
    else if (document.nodes.some((node) => node.box[axis] < anchor[axis] - EPS)) {
      add('layout/reading-anchor', '/layout/readingAnchorRef', 'Reading anchor must be at the leading edge of the diagram. This anchor and grouping may require separate views.');
    }
  }
  const groups = new Map(document.groups.map((item) => [item.ref, item.box]));
  const relations = new Map(document.model.relationships.map((item) => [item.id, item]));
  for (const [index, node] of document.nodes.entries()) {
    if (!contains(canvas, node.box)) add('geometry/canvas', `/nodes/${index}`, 'Node exceeds the canvas.');
    const entity = document.model.entities.find((item) => item.id === node.ref);
    if (node.box.width < 232 || node.box.height < 104 + wrap(entity.label, 26).length * 20 + (node.ref === document.layout.readingAnchorRef ? 24 : 0)) add('geometry/node-size', `/nodes/${index}`, 'Node is too small for the renderer text contract.');
    for (const other of document.nodes.slice(index + 1)) if (overlaps(node.box, other.box)) add('geometry/overlap', `/nodes/${index}`, `Node overlaps "${other.ref}".`);
  }
  const parents = new Map(frameMemberships(document.model, perspective).map((item) => [item.memberRef, item.group.value]));
  function ancestor(ref, groupRef) {
    const seen = new Set();
    while (parents.has(ref) && !seen.has(ref)) {
      seen.add(ref); ref = parents.get(ref);
      if (ref === groupRef) return true;
    }
    return false;
  }
  for (const [index, group] of document.groups.entries()) {
    if (!contains(canvas, group.box)) add('geometry/canvas', `/groups/${index}`, 'Group exceeds the canvas.');
    for (const node of document.nodes) {
      const belongs = ancestor(node.ref, group.ref);
      if (belongs && !contains(group.box, node.box)) add('geometry/membership', `/groups/${index}`, 'A declared group member lies outside its frame.');
      if (!belongs && overlaps(group.box, node.box)) add('geometry/false-containment', `/groups/${index}`, 'The frame encloses an unrelated entity.');
    }
    for (const other of document.groups.slice(index + 1)) {
      if (!ancestor(group.ref, other.ref) && !ancestor(other.ref, group.ref) && overlaps(group.box, other.box)) add('geometry/group-overlap', `/groups/${index}`, 'Unrelated grouping frames overlap.');
    }
    const parent = parents.get(group.ref);
    if (groups.has(parent) && !contains(groups.get(parent), group.box)) add('geometry/membership', `/groups/${index}`, 'A nested group lies outside its declared parent.');
  }
  document.edges.forEach((edge, index) => {
    const path = `/edges/${index}`;
    const relation = relations.get(edge.ref);
    if (edge.from !== relation.from || edge.to !== relation.to) add('layout/rewired', path, 'Edge direction and endpoints must match JSON 1.');
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) { add('layout/endpoint', path, 'Unknown visual endpoint.'); return; }
    if (!onBorder(edge.points[0], nodes.get(edge.from)) || !onBorder(edge.points.at(-1), nodes.get(edge.to))) add('geometry/endpoint', path, 'Route must begin and end on the correct node borders.');
    const lines = edgeLines(relation);
    if (edge.label.width < Math.max(...lines.map(units)) * 7.2 + 16 - EPS || edge.label.height < lines.length * 18 + 12 - EPS) add('geometry/label-size', path, 'Edge label is too small for its full text and qualification.');
    if (!contains(canvas, edge.label)) add('geometry/canvas', path, 'Label exceeds the canvas.');
    for (const node of document.nodes) if (overlaps(edge.label, node.box)) add('geometry/label-node', path, 'Edge label overlaps a node.');
    for (const other of document.edges.slice(index + 1)) if (overlaps(edge.label, other.label)) add('geometry/label-overlap', path, 'Edge labels overlap.');
    edge.points.forEach((point, pointIndex) => {
      if (!contains(canvas, { ...point, width: 0, height: 0 })) add('geometry/canvas', path, 'Route exceeds canvas.');
      if (!pointIndex) return;
      const previous = edge.points[pointIndex - 1];
      if (Math.abs(point.x - previous.x) > EPS && Math.abs(point.y - previous.y) > EPS) add('geometry/diagonal', path, 'Routes must be orthogonal.');
      for (const node of document.nodes) if (cutsBox(previous, point, node.box)) add('geometry/route-node', path, `Route crosses node "${node.ref}".`);
      for (const other of document.edges) if (other.ref !== edge.ref && cutsBox(previous, point, other.label)) add('geometry/route-label', path, `Route crosses label "${other.ref}".`);
    });
  });
  return { ok: diagnostics.length === 0, diagnostics, summary: modelResult.summary, warnings: diagnostics.length ? [] : (document.graphs ? document.graphs.flatMap((graph) => inspectReadability(graph, graph.ref)) : inspectReadability(document, document.model.id)) };
}
