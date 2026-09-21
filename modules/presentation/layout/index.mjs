import fs from 'node:fs';
import { layoutWorkflow } from '../workflow/layout.mjs';
import { layoutSequence } from '../sequence/layout.mjs';
import { layoutRelational } from '../relational/layout.mjs';
import { projectGraph, graphsOf, graphNodes } from '../../knowledge/architecture/graphs.mjs';
import { createRequire } from 'node:module';
import ELK from 'elkjs/lib/elk.bundled.js';
import { validateModel } from '../../knowledge/architecture/model.mjs';
import { validateLayout } from './validate.mjs';
import { digest, fail } from '../../knowledge/shared/model.mjs';
import { frameMemberships, visibleGroups, wrap, edgeLines, units } from '../shared/model.mjs';

export { inspectReadability } from './readability.mjs';
export { validateLayout } from './validate.mjs';
const elkVersion = JSON.parse(fs.readFileSync(createRequire(import.meta.url).resolve('elkjs/package.json'), 'utf8')).version;
const box = (item, x = 0, y = 0) => ({ x: item.x + x, y: item.y + y, width: item.width, height: item.height });

export async function layoutModel(input, options = {}) {
  if (input?.diagramType === 'relational') return layoutRelational(input, options);
  if (input?.diagramType === 'sequence') return layoutSequence(input, options);
  const result = validateModel(input);
  if (!result.ok) fail('JSON 1 is invalid.', result.diagnostics);
  const allowed = ['direction', 'groupingPerspectiveRef', 'readingAnchors'];
  if (Object.keys(options).some((key) => !allowed.includes(key))) fail('Unknown layout option.');
  const direction = options.direction ?? 'RIGHT';
  const groupingPerspectiveRef = options.groupingPerspectiveRef ?? null;
  if (!['RIGHT', 'DOWN'].includes(direction)) fail('Direction must be RIGHT or DOWN.');
  if (groupingPerspectiveRef !== null && !input.perspectives.some((item) => item.id === groupingPerspectiveRef)) fail('Unknown grouping perspective.');
  const readingAnchors = options.readingAnchors === undefined ? {} : options.readingAnchors;
  if (!readingAnchors || typeof readingAnchors !== 'object' || Array.isArray(readingAnchors)) fail('readingAnchors must map graph IDs to component IDs.');
  for (const [graphRef, nodeRef] of Object.entries(readingAnchors)) {
    const selection = graphsOf(input).find((graph) => graph.id === graphRef);
    if (!selection) fail(`Unknown reading-anchor graph "${graphRef}".`);
    if (typeof nodeRef !== 'string' || !graphNodes(selection).includes(nodeRef)) fail(`Reading anchor "${nodeRef}" must name a component shown in graph "${graphRef}".`);
  }
  if (input.graphs) {
    const graphs = [];
    for (const graph of [...input.graphs].sort((a, b) => a.id.localeCompare(b.id))) {
      const { layout, canvas, nodes, groups, edges } = await layoutModel(projectGraph(input, graph.id), {
        ...options, readingAnchors: Object.hasOwn(readingAnchors, graph.id) ? { [graph.id]: readingAnchors[graph.id] } : {},
      });
      graphs.push({ ref: graph.id, layout, canvas, nodes, groups, edges });
    }
    const workflows = [];
    for (const workflow of [...(input.workflows ?? [])].sort((a,b) => a.id.localeCompare(b.id))) workflows.push(await layoutWorkflow(input, workflow, { direction, groupingPerspectiveRef }, `elk-layered@${elkVersion}`));
    const output = { schemaVersion: input.schemaVersion === '0.5-draft' ? '0.4-draft' : '0.3-draft', model: structuredClone(input), modelDigest: digest(input), graphs, ...(input.workflows ? { workflows } : {}) };
    const verified = validateLayout(output, { expectedModel: input });
    if (!verified.ok) fail('Generated graph layouts failed validation.', verified.diagnostics);
    return output;
  }
  const model = structuredClone(input);
  const groupIds = visibleGroups(model, groupingPerspectiveRef);
  const parents = new Map(frameMemberships(model, groupingPerspectiveRef).map((item) => [item.memberRef, item.group.value]));
  const readingAnchorRef = Object.hasOwn(readingAnchors, model.id) ? readingAnchors[model.id] : undefined;
  const first = new Set();
  // Constrain the anchor and its enclosing frames at each hierarchy level.
  // ELK retains the real edges and routes incoming arrows back to the anchor.
  if (readingAnchorRef) for (let ref = readingAnchorRef; ref; ref = parents.get(ref)) first.add(ref);
  // Cross-hierarchy ports may enter a nested first layer. Only the outermost
  // anchor unit can use ELK's exclusive first layer (which forbids such ports).
  const anchorConstraint = (ref) => parents.has(ref) ? 'FIRST' : 'FIRST_SEPARATE';
  const graph = {
    id: '__canvas',
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': direction, 'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.randomSeed': '1',
      'elk.json.edgeCoords': 'ROOT',
      'elk.spacing.nodeNode': '80', 'elk.layered.spacing.nodeNodeBetweenLayers': '110',
      'elk.spacing.edgeNode': '35', 'elk.spacing.edgeLabel': '16',
      'elk.layered.spacing.edgeNodeBetweenLayers': '35',
      'elk.padding': '[top=36,left=36,bottom=36,right=36]',
      ...(readingAnchorRef ? { 'elk.separateConnectedComponents': 'false' } : {}),
    }, children: [], edges: [],
  };
  const containers = new Map();
  for (const group of [...model.groups].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!groupIds.has(group.id)) continue;
    containers.set(group.id, {
      id: group.id, children: [], layoutOptions: {
        'elk.padding': '[top=64,left=30,bottom=30,right=30]',
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': `(${Math.max(292, units(group.label) * 8.5 + 60)},0)`,
        ...(first.has(group.id) ? { 'elk.layered.layering.layerConstraint': anchorConstraint(group.id) } : {}),
      },
    });
  }
  for (const group of containers.values()) (containers.get(parents.get(group.id)) ?? graph).children.push(group);
  for (const entity of [...model.entities].sort((a, b) => a.id.localeCompare(b.id))) {
    const lines = wrap(entity.label, 26);
    const node = { id: entity.id, width: Math.max(232, Math.max(...lines.map(units)) * 9 + 36), height: 104 + lines.length * 20 + (entity.id === readingAnchorRef ? 24 : 0) };
    if (first.has(entity.id)) node.layoutOptions = { 'elk.layered.layering.layerConstraint': anchorConstraint(entity.id) };
    (containers.get(parents.get(entity.id)) ?? graph).children.push(node);
  }
  for (const edge of [...model.relationships].sort((a, b) => a.id.localeCompare(b.id))) {
    const lines = edgeLines(edge);
    graph.edges.push({ id: edge.id, sources: [edge.from], targets: [edge.to], labels: [{
      id: `label-${edge.id}`, text: lines.join('\n'),
      width: Math.max(...lines.map(units)) * 7.2 + 16, height: lines.length * 18 + 12,
      layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' },
    }] });
  }

  const placed = await new ELK().layout(graph);
  const output = {
    schemaVersion: model.schemaVersion === '0.3-draft' ? '0.2-draft' : '0.1-draft', model, modelDigest: digest(model),
    layout: { engine: `elk-layered@${elkVersion}`, direction, groupingPerspectiveRef, ...(readingAnchorRef ? { readingAnchorRef } : {}) },
    canvas: { width: placed.width, height: placed.height }, nodes: [], groups: [], edges: [],
  };
  function flatten(container, offsetX, offsetY) {
    for (const child of container.children ?? []) {
      const bounds = box(child, offsetX, offsetY);
      if (groupIds.has(child.id)) {
        output.groups.push({ ref: child.id, box: bounds });
        flatten(child, bounds.x, bounds.y);
      } else output.nodes.push({ ref: child.id, box: bounds });
    }
    for (const edge of container.edges ?? []) {
      if (edge.sections?.length !== 1 || edge.labels?.length !== 1) fail(`Unsupported layout routing for "${edge.id}"; expected one continuous route and label.`);
      const section = edge.sections[0];
      const source = model.relationships.find((item) => item.id === edge.id);
      output.edges.push({ ref: edge.id, from: source.from, to: source.to,
        points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((point) => ({ x: point.x, y: point.y })),
        label: box(edge.labels[0]),
      });
    }
  }
  flatten(placed, 0, 0);
  for (const key of ['nodes', 'groups', 'edges']) output[key].sort((a, b) => a.ref.localeCompare(b.ref));
  const verified = validateLayout(output, { expectedModel: input });
  if (!verified.ok) fail('Generated geometry failed validation; no artifact was accepted.', verified.diagnostics);
  return output;
}
