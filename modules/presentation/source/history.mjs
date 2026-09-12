// A browsing trail records visits, not an inferred execution path.
export function visitReadingTrail(trail, id, currentView, reset = false) {
  const saved = trail.map((entry, index) => index === trail.length - 1 ? { ...entry, ...currentView } : { ...entry });
  const found = reset ? -1 : saved.findLastIndex(entry => entry.id === id);
  if (found >= 0) return saved.slice(0, found + 1);
  const entry = { id, mode: currentView.mode, limit: 8, otherOpen: false };
  return reset ? [entry] : [...saved, entry];
}

// Keep recorded connections to visited neighbors inside the bounded view, then
// reserve an incoming slot so a fresh visit is not exclusively outgoing calls.
export function prioritizeReadingEdges(edges, focusRef, trailRefs) {
  const visited = new Set(trailRefs.filter(id => id !== focusRef));
  const pinned = edges.filter(e => visited.has(e.from === focusRef ? e.to : e.from));
  const remaining = edges.filter(e => !pinned.includes(e));
  const incoming = remaining.filter(e => e.to === focusRef && e.from !== focusRef);
  const outgoing = remaining.filter(e => e.from === focusRef);
  return [...pinned, ...incoming.slice(0, 1), ...outgoing, ...incoming.slice(1)];
}

export function readingRecordLabel(record) {
  return record?.name ?? record?.path ?? 'Unindexed source';
}
