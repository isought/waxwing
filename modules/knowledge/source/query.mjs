import { validateSourceSnapshot } from './model.mjs';
import { sourceNavigation } from './navigation.mjs';
import { fail } from '../shared/model.mjs';

export function querySourceSnapshot(snapshot, operation, value, options = {}) {
  const validation = validateSourceSnapshot(snapshot);
  if (!validation.ok) fail('Invalid source snapshot.', validation.diagnostics);
  if (typeof value !== 'string' || !value.trim()) throw new Error('Source query requires nonempty text or a record ID.');
  if (Object.keys(options).some(k => !['limit', 'offset', 'budget'].includes(k))) throw new Error('Unknown source query option.');
  const { limit = 20, offset = 0, budget = 12000 } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(budget) || budget < 64 || budget > 1000000) throw new Error('Invalid source query limit, offset or budget.');
  const all = [...snapshot.files, ...snapshot.declarations, ...snapshot.references];
  let items;
  if (operation === 'search') {
    const text = value.toLowerCase();
    items = all.filter(r => (r.name ?? r.path).toLowerCase().includes(text));
  } else {
    const record = all.find(r => r.id === value);
    if (!record) throw new Error(`Unknown source record ${value}.`);
    if (operation === 'inspect') items = [record];
    else if (operation === 'references') items = snapshot.references.filter(r => r.resolution.targets.includes(value) || r.resolution.targets.some(id => snapshot.declarations.find(d => d.id === id)?.valueProvenance?.resolution.targets.includes(value)));
    else if (operation === 'functions') {
      if (!snapshot.files.some(f => f.id === value)) throw new Error('functions requires a file ID.');
      items = snapshot.declarations.filter(d => d.fileRef === value && ['function', 'method', 'class'].includes(d.kind));
    } else if (operation === 'outgoing') {
      if (!snapshot.files.some(f => f.id === value) && !snapshot.declarations.some(d => d.id === value && ['function', 'method'].includes(d.kind))) throw new Error('outgoing requires a file or named callable ID.');
      items = sourceNavigation(snapshot).relationships.filter(r => (record.path ? r.reference.fileRef === value : r.callerRef === value) && ['call', 'construct'].includes(r.reference.kind)).map(r => r.reference);
    } else if (operation === 'imports') {
      if (!snapshot.files.some(f => f.id === value)) throw new Error('imports requires a file ID.');
      items = snapshot.references.filter(r => r.fileRef === value && ['import', 're-export', 'dynamic-import', 'require'].includes(r.kind));
    } else throw new Error(`Unknown source query operation ${operation}.`);
  }
  const results = []; let used = 2;
  for (const item of items.slice(offset, offset + limit)) {
    const size = JSON.stringify(item).length + (results.length ? 1 : 0);
    if (used + size > budget) break;
    results.push(structuredClone(item)); used += size;
  }
  const omitted = Math.max(0, items.length - offset - results.length);
  return { snapshotId: snapshot.id, source: { ...snapshot.source }, operation, total: items.length, offset, results, omitted,
    nextOffset: omitted && results.length ? offset + results.length : null,
    ...(omitted && !results.length ? { minimumNextItemCharacters: JSON.stringify(items[offset]).length + 2 } : {}),
    budget: { characters: budget, used, appliesTo: 'Serialized results; metadata is additional.' },
    semantics: 'Source occurrences and static bindings within this snapshot. Candidate targets are not resolved calls or proof of runtime execution. Absence of results is not proof of absence.' };
}
