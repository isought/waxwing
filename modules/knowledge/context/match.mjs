// Deterministic lexical matching over recorded names, paths and authored text.
// Terms are supplied explicitly; nothing is extracted from prose. A match is a
// retrieval basis, never a relevance proof.

export const MAX_TERMS = 20;
export const MAX_TERM_CHARACTERS = 500;

export function contextTerms(terms = []) {
  if (!Array.isArray(terms) || terms.length > MAX_TERMS) throw new Error(`Supply at most ${MAX_TERMS} terms.`);
  const result = [], seen = new Set();
  for (const term of terms) {
    if (typeof term !== 'string' || !term.trim() || term.length > MAX_TERM_CHARACTERS) throw new Error(`Each --term must be nonempty text of at most ${MAX_TERM_CHARACTERS} characters.`);
    const text = term.trim(), key = text.toLowerCase();
    if (!seen.has(key)) { seen.add(key); result.push(text); }
  }
  return result;
}

// "path:line" or "path:line:column", as printed by grep -n, compilers and stack traces.
export function parseLocation(value) {
  const match = typeof value === 'string' && value.trim().match(/^(.+?):(\d+)(?::\d+)?$/);
  if (!match || Number(match[2]) < 1) throw new Error(`--at requires path:line, for example src/app.ts:42 (received ${JSON.stringify(value)}).`);
  const file = match[1].replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  return { text: value.trim(), path: file, line: Number(match[2]) };
}

const kindRank = { component: 9, workflow: 8, step: 6, relationship: 5, document: 7, group: 4, graph: 4, block: 3, note: 3, source: 2, model: 1,
  file: 7, class: 8, function: 8, method: 8, interface: 7, type: 6, enum: 6, module: 6, namespace: 5, variable: 3, property: 2, parameter: 1 };

function matchEntry(entry, term) {
  const needle = term.toLowerCase(), title = (entry.title ?? '').toLowerCase(), label = `term "${term}"`;
  if (entry.recordId === term) return { score: 100, basis: `${label} equals the record ID` };
  if (title === needle || entry.name?.toLowerCase() === needle) return { score: 90, basis: `${label} equals the ${entry.path && !entry.name ? 'path' : 'name'}` };
  const path = entry.path?.toLowerCase();
  if (path && (path.endsWith('/' + needle) || path.split('/').at(-1).replace(/\.[^.]+$/, '') === needle)) return { score: 80, basis: `${label} matches the file path` };
  if (needle.length >= 3 && title.includes(needle)) return { score: 50, basis: `${label} appears in the ${entry.path && !entry.name ? 'path' : 'name'}` };
  if (needle.length >= 3 && path?.includes(needle)) return { score: 40, basis: `${label} appears in the file path` };
  if (entry.authored && needle.length >= 3 && entry.text?.toLowerCase().includes(needle)) return { score: 20, basis: `${label} appears in recorded text` };
  return null;
}

// entries: {sourceKey, recordId, kind, title, name?, path?, text?, authored}
export function matchCandidates(entries, terms, { limit = 50 } = {}) {
  const matched = [];
  for (const entry of entries) {
    const hits = terms.map(term => matchEntry(entry, term)).filter(Boolean).sort((a, b) => b.score - a.score);
    if (!hits.length) continue;
    const score = hits[0].score + Math.min(hits.length - 1, 5) * 5;
    matched.push({ entry, score, matchBasis: hits.slice(0, 3).map(hit => hit.basis) });
  }
  matched.sort((a, b) => b.score - a.score || (kindRank[b.entry.kind] ?? 0) - (kindRank[a.entry.kind] ?? 0)
    || String(a.entry.title).localeCompare(String(b.entry.title)) || a.entry.sourceKey.localeCompare(b.entry.sourceKey) || a.entry.recordId.localeCompare(b.entry.recordId));
  return { total: matched.length, matches: matched.slice(0, limit) };
}

// A small vocabulary lets an agent choose a term that exists in the available records.
export function contextVocabulary(entries, { limit = 40 } = {}) {
  const preferred = entries.filter(entry => entry.authored ? ['component', 'workflow', 'document'].includes(entry.kind) : ['class', 'function', 'method', 'interface'].includes(entry.kind));
  const seen = new Set(), vocabulary = [];
  for (const entry of preferred.sort((a, b) => (kindRank[b.kind] ?? 0) - (kindRank[a.kind] ?? 0) || String(a.title).localeCompare(String(b.title)))) {
    const key = String(entry.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); vocabulary.push(entry.title);
    if (vocabulary.length >= limit) break;
  }
  return vocabulary;
}

// Recorded items at a location: the innermost enclosing callable or type spanning the
// line, then its file. Variables and properties on that line are not enclosing scopes.
const enclosingKinds = new Set(['function', 'method', 'class', 'interface', 'type-alias', 'enum', 'namespace', 'table']);
// Paths match exactly or by a whole-segment suffix in either direction.
export function locateCandidates(entries, location) {
  const wanted = location.path.toLowerCase();
  const samePath = recorded => { const value = recorded.toLowerCase(); return value === wanted || value.endsWith('/' + wanted) || wanted.endsWith('/' + value); };
  const matches = [], label = `location "${location.text}"`;
  for (const file of entries.filter(entry => entry.kind === 'file' && !entry.line && samePath(entry.path))) {
    const enclosing = entries.filter(entry => enclosingKinds.has(entry.kind) && entry.sourceKey === file.sourceKey && entry.path === file.path && entry.span
      && entry.span.start.line <= location.line && entry.span.end.line >= location.line)
      .sort((a, b) => (a.span.end.offset - a.span.start.offset) - (b.span.end.offset - b.span.start.offset));
    if (enclosing[0]) matches.push({ entry: enclosing[0], score: 100, matchBasis: [`${label} is inside this ${enclosing[0].kind} (lines ${enclosing[0].span.start.line}–${enclosing[0].span.end.line})`] });
    matches.push({ entry: file, score: 90, matchBasis: [file.status === 'skipped' ? `${label} is in this file, which the scan skipped` : enclosing[0] ? `${label} is in this file` : `${label} is in this file, outside any recorded declaration`] });
  }
  // Line-only records (Graphify) have no ranges: report the nearest recorded start at or above the line.
  for (const file of new Set(entries.filter(entry => entry.line && !entry.span && entry.path && samePath(entry.path)).map(entry => `${entry.sourceKey}\0${entry.path}`))) {
    const [sourceKey, recorded] = file.split('\0');
    const inFile = entries.filter(entry => entry.sourceKey === sourceKey && entry.path === recorded && entry.line && !entry.span);
    const before = inFile.filter(entry => entry.kind !== 'file' && entry.line <= location.line).sort((a, b) => b.line - a.line || (b.kind === 'callable') - (a.kind === 'callable'));
    const preceding = before.find(entry => entry.kind === 'callable') ?? before[0];
    if (preceding) matches.push({ entry: preceding, score: 95, matchBasis: [`${label}: nearest preceding recorded ${preceding.kind} (starts line ${preceding.line}); start lines only, so containment is not established`] });
    const fileNode = inFile.find(entry => entry.kind === 'file');
    if (fileNode) matches.push({ entry: fileNode, score: 85, matchBasis: [`${label} is in this file`] });
  }
  return matches;
}
