// Deterministic lexical matching. Supplied clues and identifier-shaped question
// tokens can match names, paths and recorded text; ordinary question words only
// match authored titles. A match is a retrieval basis, never a relevance proof.

const stopwords = new Set(('a an and are as at be because but by can could did do does doing done for from get gets got had has have how i if in into is it its '
  + 'me my no not of on or our should so some than that the their them then there these they this those to up us was we were what when where which '
  + 'while who why will with would you your after before during happen happens happening returned returns return result results wrong fails failing '
  + 'failed error errors issue problem work works working api value values call calls called using use used').split(' '));

export const MAX_QUESTION_CHARACTERS = 4000;
export const MAX_CLUES = 20;
export const MAX_CLUE_CHARACTERS = 500;

export function contextTerms(question, clues = []) {
  if (typeof question !== 'string' || !question.trim()) throw new Error('context requires a nonempty --question.');
  if (question.length > MAX_QUESTION_CHARACTERS) throw new Error(`Question must be at most ${MAX_QUESTION_CHARACTERS} characters.`);
  if (!Array.isArray(clues) || clues.length > MAX_CLUES) throw new Error(`Supply at most ${MAX_CLUES} clues.`);
  const terms = [], seen = new Set();
  const add = (text, origin) => {
    const value = text.trim(), key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key); terms.push({ text: value, origin });
  };
  for (const clue of clues) {
    if (typeof clue !== 'string' || !clue.trim() || clue.length > MAX_CLUE_CHARACTERS) throw new Error(`Each clue must be nonempty text of at most ${MAX_CLUE_CHARACTERS} characters.`);
    add(clue, 'clue');
  }
  const quoted = [...question.matchAll(/`([^`\n]{2,200})`/g)].map(match => match[1]);
  for (const value of quoted) add(value, 'identifier');
  const withoutQuoted = question.replace(/`[^`\n]*`/g, ' ');
  for (const token of withoutQuoted.match(/[A-Za-z_$@][\w$@-]*(?:[./:#][\w$@-]+)+|[A-Za-z_$][\w$]*\(\)|[\w$]*[a-z0-9][A-Z][\w$]*|[A-Za-z0-9]+_[\w$]+/g) ?? []) {
    add(token.replace(/\(\)$/, '').replace(/[.:#]+$/, ''), 'identifier');
  }
  for (const word of withoutQuoted.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
    if (!stopwords.has(word) && !seen.has(word)) add(word, 'word');
  }
  return terms;
}

const kindRank = { component: 9, workflow: 8, step: 6, relationship: 5, document: 7, group: 4, graph: 4, block: 3, note: 3, source: 2, model: 1,
  file: 7, class: 8, function: 8, method: 8, interface: 7, type: 6, enum: 6, module: 6, namespace: 5, variable: 3, property: 2, parameter: 1 };
const originLabel = { clue: 'supplied clue', identifier: 'identifier in question', word: 'question word' };
const words = text => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));

function matchEntry(entry, term) {
  const needle = term.text.toLowerCase(), title = (entry.title ?? '').toLowerCase(), label = originLabel[term.origin];
  if (term.origin === 'word') {
    return entry.authored && words(title).has(needle) ? { score: 30, basis: `${label} "${term.text}" appears in the recorded title` } : null;
  }
  if (entry.recordId === term.text) return { score: 100, basis: `${label} "${term.text}" equals the record ID` };
  if (title === needle) return { score: 90, basis: `${label} "${term.text}" equals the ${entry.path && !entry.name ? 'path' : 'name'}` };
  const path = entry.path?.toLowerCase();
  if (path && (path.endsWith('/' + needle) || path.split('/').at(-1).replace(/\.[^.]+$/, '') === needle)) return { score: 80, basis: `${label} "${term.text}" matches the file path` };
  if (needle.length >= 3 && title.includes(needle)) return { score: 50, basis: `${label} "${term.text}" appears in the ${entry.path && !entry.name ? 'path' : 'name'}` };
  if (needle.length >= 3 && path?.includes(needle)) return { score: 40, basis: `${label} "${term.text}" appears in the file path` };
  if (entry.authored && needle.length >= 3 && entry.text?.toLowerCase().includes(needle)) return { score: 20, basis: `${label} "${term.text}" appears in recorded text` };
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

// A small vocabulary lets an agent choose a clue that exists in the available records.
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
