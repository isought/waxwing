// Presentation-only projection. No new resolution or inferred intent.
export function readingProjection(data, focusRef) {
  const declarations = new Map(data.declarations.map(d => [d.id, d]));
  const callable = id => ['function', 'method'].includes(declarations.get(id)?.kind);
  const internal = [], other = [], pairs = new Map();
  for (const item of data.relationships) {
    const r = item.reference;
    if (!['call', 'construct'].includes(r.kind)) continue;
    const targets = new Map();
    if (r.resolution.status === 'resolved') {
      for (const id of r.resolution.targets) if (callable(id)) targets.set(id, 'binding');
      for (const p of item.provenance) {
        if (p.resolution.status === 'resolved') for (const id of p.resolution.targets) {
          if (callable(id)) targets.set(id, 'export-origin');
        }
      }
    }
    if (item.callerRef === focusRef && !targets.size) other.push(item);
    for (const [target, basis] of targets) {
      if (item.callerRef !== focusRef && target !== focusRef) continue;
      const key = JSON.stringify([item.callerRef, target]);
      if (!pairs.has(key)) pairs.set(key, { from: item.callerRef, to: target, occurrences: [], bases: [] });
      const edge = pairs.get(key);
      if (!edge.occurrences.includes(r.id)) edge.occurrences.push(r.id);
      if (!edge.bases.includes(basis)) edge.bases.push(basis);
    }
    if (item.callerRef === focusRef && targets.size) internal.push(item);
  }
  return { focusRef, edges: [...pairs.values()], internal, other };
}
