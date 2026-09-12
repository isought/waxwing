import Ajv2020 from 'ajv/dist/2020.js';
import { validateModel } from '../architecture/model.mjs';
import { graphsOf, graphNodes } from '../architecture/graphs.mjs';
import { validateSourceSnapshot } from '../source/model.mjs';
import { digest, fail } from '../shared/model.mjs';

export const SOURCE_LINKS_VERSION = '0.1-source-links-draft';

const id = { type: 'string', pattern: '^[a-z][a-z0-9_-]*$' };
const text = { type: 'string', minLength: 1, pattern: '\\S' };
const refs = { type: 'array', uniqueItems: true, items: id };
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const schema = object({
  schemaVersion: { const: SOURCE_LINKS_VERSION },
  modelId: id,
  modelDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  snapshotId: { type: 'string', pattern: '^snapshot-[a-f0-9]{64}$' },
  links: { type: 'array', items: object({
    id,
    subject: object({ kind: { enum: ['node', 'edge'] }, graphRef: id, ref: id }),
    entryRef: id,
    evidenceRefs: refs,
    label: text,
    basis: object({
      status: { enum: ['established', 'reported', 'inferred'] },
      explanation: text,
      sourceRefs: { ...refs, minItems: 1 },
    }),
    rationaleNoteRefs: refs,
  }) },
});
const validateShape = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

function inputDiagnostics(model, snapshot) {
  return [['model', validateModel(model)], ['snapshot', validateSourceSnapshot(snapshot)]].flatMap(([name, result]) =>
    result.ok ? [] : result.diagnostics.map(d => ({
      code: `source-links/${name}`, path: `/${name}${d.path ?? ''}`, message: `${d.code}: ${d.message}`,
    })));
}

function linkDiagnostics(model, snapshot, sidecar) {
  // No bridge is a valid state: neither native model depends on its existence.
  if (sidecar === undefined || sidecar === null) return [];
  if (!validateShape(sidecar)) return validateShape.errors.map(e => ({ code: 'source-links/schema', path: e.instancePath, message: e.message }));
  const diagnostics = [];
  const add = (code, path, message) => diagnostics.push({ code: `source-links/${code}`, path, message });
  if (sidecar.modelId !== model.id) add('identity', '/modelId', 'The bridge names a different explanation model.');
  if (sidecar.modelDigest !== digest(model)) add('identity', '/modelDigest', 'The explanation has changed since this bridge was recorded.');
  if (sidecar.snapshotId !== snapshot.id) add('identity', '/snapshotId', 'The bridge names a different source snapshot.');
  if (!sidecar.links.length) return diagnostics;
  if (model.diagramType === 'sequence') {
    add('subject', '/links', 'This bridge draft supports architecture nodes and edges only.');
    return diagnostics;
  }

  const graphs = new Map(graphsOf(model).map(g => [g.id, g]));
  const nodes = new Map(model.entities.map(r => [r.id, r]));
  const edges = new Map(model.relationships.map(r => [r.id, r]));
  const files = new Map(snapshot.files.map(f => [f.id, f]));
  const declarations = new Map(snapshot.declarations.map(d => [d.id, d]));
  const records = new Set([...snapshot.files, ...snapshot.declarations, ...snapshot.references].map(r => r.id));
  const sources = new Set(model.sources.map(s => s.id));
  const notes = new Map(model.notes.map(n => [n.id, n]));
  const ids = new Set();
  for (const [i, link] of sidecar.links.entries()) {
    const pointer = `/links/${i}`;
    if (ids.has(link.id)) add('duplicate', `${pointer}/id`, 'Bridge link IDs must be unique.');
    ids.add(link.id);
    const graph = graphs.get(link.subject.graphRef);
    const collection = link.subject.kind === 'node' ? nodes : edges;
    const shown = graph && (link.subject.kind === 'node' ? graphNodes(graph) : graph.relationshipRefs);
    if (!graph || !collection.has(link.subject.ref) || !shown.includes(link.subject.ref)) {
      add('subject', `${pointer}/subject`, 'The subject must be a node or edge included in the named graph.');
    }

    const file = files.get(link.entryRef), declaration = declarations.get(link.entryRef);
    if (!(file?.status === 'analyzed' || declaration && ['function', 'method'].includes(declaration.kind) && files.get(declaration.fileRef)?.status === 'analyzed')) {
      add('entry', `${pointer}/entryRef`, 'The source entry must be an analyzed file or a named function or method.');
    }
    for (const [j, ref] of link.evidenceRefs.entries()) if (!records.has(ref)) {
      add('evidence', `${pointer}/evidenceRefs/${j}`, 'The evidence record is absent from this source snapshot.');
    }
    for (const [j, ref] of link.basis.sourceRefs.entries()) if (!sources.has(ref)) {
      add('source', `${pointer}/basis/sourceRefs/${j}`, 'The basis must cite a source registered in the explanation model.');
    }
    for (const [j, ref] of link.rationaleNoteRefs.entries()) {
      const note = notes.get(ref);
      if (!note || note.topic !== 'rationale' || !note.subjectRefs.includes(link.subject.ref)) {
        add('rationale', `${pointer}/rationaleNoteRefs/${j}`, 'The rationale must be a rationale note attached to this subject.');
      }
    }
  }
  return diagnostics;
}

export function validateSourceLinks(model, snapshot, sidecar) {
  const diagnostics = inputDiagnostics(model, snapshot);
  if (!diagnostics.length) diagnostics.push(...linkDiagnostics(model, snapshot, sidecar));
  return { ok: !diagnostics.length, diagnostics };
}

function collectSourceRefs(value, refs) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value.sourceRefs)) value.sourceRefs.forEach(ref => refs.add(ref));
  Object.values(value).forEach(child => collectSourceRefs(child, refs));
}

// The projector fails for invalid native inputs, but a stale or malformed
// optional bridge only disables cross-level navigation. Never rebind by name.
export function projectSourceLinks(model, snapshot, sidecar) {
  const inputs = inputDiagnostics(model, snapshot);
  if (inputs.length) fail('Invalid explanation model or source snapshot.', inputs);
  const diagnostics = linkDiagnostics(model, snapshot, sidecar);
  if (diagnostics.length || sidecar === undefined || sidecar === null) return { links: [], diagnostics };
  const subjects = new Map([...(model.entities ?? []), ...(model.relationships ?? [])].map(r => [r.id, r]));
  const notes = new Map(model.notes.map(n => [n.id, n]));
  const links = sidecar.links.map(link => {
    const rationale = link.rationaleNoteRefs.map(ref => notes.get(ref));
    const sourceRefs = new Set(link.basis.sourceRefs);
    rationale.forEach(note => collectSourceRefs(note, sourceRefs));
    return { ...link, subjectLabel: subjects.get(link.subject.ref).label, rationale,
      sources: model.sources.filter(source => sourceRefs.has(source.id)) };
  });
  return { links: structuredClone(links), diagnostics };
}
