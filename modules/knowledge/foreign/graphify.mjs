import { validSourcePath } from '../source/model.mjs';

export const GRAPHIFY_FORMAT = 'graphify';

// Read-only adapter for the inspected Graphify node-link subset. Imported
// relationships stay Graphify's extraction claims, with their confidence; they
// are never promoted to Waxwing facts, execution order or causation.
const knownGraphKeys = new Set(['directed', 'multigraph', 'graph', 'nodes', 'links', 'edges', 'hyperedges', 'built_at_commit']);
const knownNodeKeys = new Set(['id', 'label', 'norm_label', 'file_type', 'source_file', 'source_location', 'community', 'community_name', 'confidence', '_callable', '_origin']);
const knownEdgeKeys = new Set(['source', 'target', '_src', '_tgt', 'relation', 'confidence', 'confidence_score', 'context', 'source_file', 'source_location', 'weight', 'deferred', '_origin', 'key']);

export const looksLikeGraphify = value => !!value && typeof value === 'object' && !Array.isArray(value) && !Object.hasOwn(value, 'schemaVersion')
  && Array.isArray(value.nodes) && (Array.isArray(value.links) || Array.isArray(value.edges));

const text = value => typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : null;

// "L54" or "L54-L60"; anything else is kept as an unparsed locator.
export function parseGraphifyLocation(value) {
  const match = typeof value === 'string' && value.match(/^L(\d+)(?:\s*[-–]\s*L?(\d+))?$/);
  return match ? { line: Number(match[1]), ...(match[2] ? { endLine: Number(match[2]) } : {}) } : null;
}

export function normalizeGraphify(data) {
  if (!looksLikeGraphify(data)) {
    const error = new Error('Not a recognized Graphify node-link graph: expected nodes and links (or edges) arrays without a schemaVersion.');
    error.code = 'unsupported-shape';
    throw error;
  }
  const diagnostics = [];
  const add = (code, message) => { if (diagnostics.length < 50) diagnostics.push({ code: `graphify/${code}`, message }); };
  const unknown = (keys, known, where) => { const extra = keys.filter(k => !known.has(k)); if (extra.length) add('unrecognized-fields', `${where} fields not interpreted: ${extra.slice(0, 8).join(', ')}.`); };
  unknown(Object.keys(data), knownGraphKeys, 'Graph');
  const edgeKey = Array.isArray(data.links) ? 'links' : 'edges';
  if (Array.isArray(data.links) && Array.isArray(data.edges)) add('edge-keys', 'Both links and edges are present; links were read and edges ignored.');
  if ((data.hyperedges ?? data.graph?.hyperedges ?? []).length) add('hyperedges', 'Hyperedges are not interpreted.');

  const nodes = new Map(), nodeFields = new Set();
  for (const [index, raw] of data.nodes.entries()) {
    const id = text(raw?.id);
    if (id === null) { add('node-id', `Node ${index} has no usable id and was skipped.`); continue; }
    if (nodes.has(id)) { add('duplicate-node', `Duplicate node id ${JSON.stringify(id)}; the first occurrence was kept.`); continue; }
    Object.keys(raw).forEach(k => nodeFields.add(k));
    const file = typeof raw.source_file === 'string' && raw.source_file ? raw.source_file.replace(/\\/g, '/').replace(/^(\.\/)+/, '') : null;
    const location = parseGraphifyLocation(raw.source_location);
    if (raw.source_location !== undefined && raw.source_location !== '' && !location) add('location', `Node ${JSON.stringify(id)} has an unparsed source_location ${JSON.stringify(raw.source_location)}.`);
    nodes.set(id, { id, label: text(raw.label) ?? id, fileType: text(raw.file_type), callable: raw._callable === true,
      ...(file ? { sourceFile: file, pathUsable: validSourcePath(file) } : {}), ...(location ?? {}),
      ...(raw.community !== undefined ? { community: raw.community } : {}), ...(raw.confidence ? { confidence: raw.confidence } : {}), raw });
  }
  unknown([...nodeFields], knownNodeKeys, 'Node');

  const edges = [], edgeFields = new Set(), seen = new Map();
  for (const [index, raw] of data[edgeKey].entries()) {
    // Undirected storage can canonicalize endpoint order; _src/_tgt carry the extracted direction.
    const hasMarkers = raw?._src !== undefined && raw?._tgt !== undefined;
    const from = text(hasMarkers ? raw._src : raw?.source), to = text(hasMarkers ? raw._tgt : raw?.target);
    if (from === null || to === null) { add('edge-endpoints', `Edge ${index} has no usable endpoints and was skipped.`); continue; }
    if (!nodes.has(from) || !nodes.has(to)) { add('edge-unknown-node', `Edge ${index} refers to an unknown node and was skipped.`); continue; }
    Object.keys(raw).forEach(k => edgeFields.add(k));
    const relation = text(raw.relation) ?? 'related';
    const base = `${from}->${to}:${relation}`, n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const location = parseGraphifyLocation(raw.source_location);
    edges.push({ id: `edge:${base}:${n}`, from, to, relation,
      direction: hasMarkers ? 'direction markers (_src/_tgt)' : data.directed === true ? 'directed graph source/target' : 'serialized source/target of an undirected graph; direction is Graphify’s export order',
      ...(raw.confidence ? { confidence: raw.confidence } : {}), ...(typeof raw.confidence_score === 'number' ? { confidenceScore: raw.confidence_score } : {}),
      ...(raw.context ? { context: raw.context } : {}), ...(typeof raw.source_file === 'string' ? { sourceFile: raw.source_file.replace(/\\/g, '/').replace(/^(\.\/)+/, '') } : {}), ...(location ?? {}) });
  }
  unknown([...edgeFields], knownEdgeKeys, 'Edge');
  return { nodes, edges, edgeKey, directed: data.directed === true, builtAtCommit: typeof data.built_at_commit === 'string' ? data.built_at_commit : null, diagnostics,
    summary: { nodes: nodes.size, edges: edges.length, skippedNodes: data.nodes.length - nodes.size, skippedEdges: data[edgeKey].length - edges.length } };
}

export const GRAPHIFY_LIMITATIONS = [
  'Graphify relationships are imported extraction claims with Graphify’s confidence labels; Waxwing did not verify them.',
  'Graph connectivity does not establish execution order, runtime behavior or causation. Community groupings are clustering output.',
  'Graphify records start lines only; enclosing ranges and current source bytes are not verified.',
];
