// The graph is a bounded projection of recorded static relationships. It does not
// synthesize a runtime path, architectural ownership, or execution order.
export function sourceNeighborhood(data, focusRef, options = {}) {
  const limit = options.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 40) throw new Error('Source graph limit must be an integer from 1 to 40.');
  const files = new Map(data.files.map(record => [record.id, record]));
  const declarations = new Map(data.declarations.map(record => [record.id, record]));
  const records = new Map([...data.files, ...data.declarations, ...(data.references ?? []), ...data.relationships.map(item => item.reference)].map(record => [record.id, record]));
  const moduleKinds = ['import', 're-export', 'dynamic-import', 'require'];
  const module = reference => moduleKinds.includes(reference.kind);
  const selected = records.get(focusRef);
  if (!selected) return { focusRef, nodes: [], edges: [], totalRelationships: 0, omittedRelationships: 0 };
  // An occurrence opens its owning callable's graph while its source remains
  // selected. Files show module boundaries; callables show their direct calls.
  const selectedRelationship = data.relationships.find(item => item.reference.id === focusRef);
  const rootRef = selectedRelationship?.callerRef ?? (files.has(focusRef) || declarations.has(focusRef) ? focusRef : selected.containerRef ?? selected.fileRef);
  const root = records.get(rootRef);
  if (!root) return { focusRef, nodes: [], edges: [], totalRelationships: 0, omittedRelationships: 0 };
  const isFile = files.has(rootRef);
  const outgoing = data.relationships.filter(item => isFile ? item.reference.fileRef === rootRef && module(item.reference) : item.callerRef === rootRef && !module(item.reference));
  const incoming = data.relationships.filter(item => !outgoing.includes(item) && (isFile ? module(item.reference) : !module(item.reference)) && (item.reference.resolution.targets.includes(rootRef) || item.provenance.some(origin => origin.resolution.targets.includes(rootRef))));
  const all = [...outgoing, ...incoming];
  const preferredRefs = new Set(options.preferredReferenceRefs ?? []);
  const preferred = all.filter(item => preferredRefs.has(item.reference.id));
  const ordered = [...preferred, ...all.filter(item => !preferredRefs.has(item.reference.id))];
  const relevant = selectedRelationship && all.includes(selectedRelationship) ? [selectedRelationship, ...ordered.filter(item => item !== selectedRelationship)] : ordered;
  const nodes = new Map(), edges = [], omitted = new Set();
  const maxNodes = 1 + limit * 4;
  const node = (id, role, fallback = {}) => {
    if (nodes.has(id)) return id;
    if (nodes.size >= maxNodes) { omitted.add(id); return null; }
    const record = records.get(id), file = record && files.get(record.fileRef ?? record.id);
    nodes.set(id, { id, ...(record ? { recordRef: id } : {}), label: record?.name ?? record?.path ?? fallback.label ?? id, kind: record?.kind ?? (record ? 'file' : fallback.kind ?? 'boundary'), role, ...(file ? { path: file.path } : {}), ...fallback });
    return id;
  };
  node(rootRef, 'focus');
  for (const item of relevant.slice(0, limit)) {
    const { reference, callerRef, provenance } = item;
    const from = outgoing.includes(item) ? rootRef : callerRef;
    if (!node(from, 'caller')) continue;
    const targets = reference.resolution.targets;
    if (!targets.length) {
      const external = ['external-builtin', 'external-package-specifier'].includes(reference.resolution.reason);
      const id = `boundary:${reference.id}`;
      if (!node(id, 'target', { label: reference.name, boundary: external ? 'external' : 'unresolved', kind: external ? 'external boundary' : 'unresolved occurrence' })) continue;
      edges.push({ from, to: id, referenceRef: reference.id, kind: module(reference) ? 'module' : 'binding', ...reference.resolution });
    }
    for (const target of targets) {
      if (!node(target, 'target', reference.resolution.status === 'ambiguous' ? { boundary: 'candidate' } : {})) continue;
      edges.push({ from, to: target, referenceRef: reference.id, kind: module(reference) ? 'module' : 'binding', ...reference.resolution });
    }
    for (const origin of provenance) {
      if (!node(origin.bindingRef, 'target')) continue;
      if (!origin.resolution.targets.length) {
        const id = `origin:${reference.id}:${origin.bindingRef}`;
        if (!node(id, 'origin', { label: origin.importedName ?? 'Unknown export', boundary: 'unresolved', kind: 'unresolved value origin' })) continue;
        edges.push({ from: origin.bindingRef, to: id, referenceRef: reference.id, moduleRef: origin.moduleRef, kind: 'provenance', ...origin.resolution });
      }
      for (const target of origin.resolution.targets) {
        if (!node(target, 'origin', origin.resolution.status === 'ambiguous' ? { boundary: 'candidate' } : {})) continue;
        edges.push({ from: origin.bindingRef, to: target, referenceRef: reference.id, moduleRef: origin.moduleRef, kind: 'provenance', ...origin.resolution });
      }
    }
  }
  return { focusRef: rootRef, nodes: [...nodes.values()], edges, totalRelationships: relevant.length, omittedRelationships: Math.max(0, relevant.length - limit), omittedNodes: omitted.size };
}
