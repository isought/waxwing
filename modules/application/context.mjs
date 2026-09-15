import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { READABLE_FORMATS, discoverKnowledge } from './discover.mjs';
import { readVerifiedSourceText } from './source-text.mjs';
import { displayPath, resolveProject } from './project.mjs';
import { modelRecords, recordText } from '../knowledge/query/index.mjs';
import { sourceNavigation } from '../knowledge/source/navigation.mjs';
import { CONTEXT_PROTOCOL, budgetTooSmall, decodeReference, encodeReference, fitPacket, packetBytes, validBudget } from '../knowledge/context/protocol.mjs';
import { contextTerms, contextVocabulary, locateCandidates, matchCandidates, parseLocation } from '../knowledge/context/match.mjs';
import { siteTargetURL } from '../presentation/site/index.mjs';
import { GRAPHIFY_LIMITATIONS } from '../knowledge/foreign/graphify.mjs';

const MAX_CANDIDATES = 20;
const hiddenDeclarationKinds = new Set(['parameter', 'type-parameter', 'import-binding', 'enum-member']);
// A revision prefix identifies staleness; the full digest remains in source metadata.
const shortRevision = revision => revision.replace(/^snapshot-/, '').slice(0, 16);
const clip = (text, length = 160) => text.length > length ? `${text.slice(0, length - 1)}…` : text;

function publicSource(source) {
  const { registrations, diagnostics, ...rest } = source;
  return { ...rest, registration: registrations[0], ...(registrations.length > 1 ? { alsoRegisteredBy: registrations.slice(1, 4) } : {}), ...(diagnostics?.length ? { diagnostics: diagnostics.slice(0, 2) } : {}) };
}

const claimText = claim => typeof claim === 'string' ? claim : typeof claim?.value === 'string' ? claim.value : claim?.basis?.explanation;
const recordSummary = record => [record.description, record.summary, record.abstraction?.represents, record.scope?.question, record.existence, record.statement, record.text].map(claimText).find(text => typeof text === 'string' && text.trim() && text !== (record.title ?? record.label));

// Graphify node kinds are coarse; file nodes are labeled with their own basename.
const graphifyKind = node => node.sourceFile && node.label === node.sourceFile.split('/').at(-1) ? 'file' : node.callable ? 'callable' : node.fileType === 'code' ? 'symbol' : node.fileType ?? 'node';

// Model step IDs are scoped by workflow; the reference record ID keeps that scope.
const stepId = (workflowRef, id) => JSON.stringify([workflowRef, id]);

function knowledgeEntries(discovery, keys) {
  const entries = [];
  for (const source of discovery.sources) {
    if (source.status !== 'available' || !keys.has(source.key)) continue;
    const loaded = discovery.loaded.get(source.key);
    if (loaded.model) {
      for (const { kind, record, workflowRef } of modelRecords(loaded.model)) {
        entries.push({ sourceKey: source.key, revision: source.revision, recordId: kind === 'step' ? stepId(workflowRef, record.id) : record.id, displayId: record.id, kind,
          title: record.title ?? record.label ?? record.id, text: recordText(record), summary: recordSummary(record), authored: true, ...(workflowRef ? { workflowRef } : {}) });
      }
    } else if (loaded.snapshot) {
      const files = new Map(loaded.snapshot.files.map(file => [file.id, file]));
      for (const file of loaded.snapshot.files) entries.push({ sourceKey: source.key, revision: source.revision, recordId: file.id, kind: 'file', title: file.path, path: file.path, status: file.status, authored: false });
      for (const declaration of loaded.snapshot.declarations) {
        if (hiddenDeclarationKinds.has(declaration.kind)) continue;
        entries.push({ sourceKey: source.key, revision: source.revision, recordId: declaration.id, kind: declaration.kind, title: declaration.name, name: declaration.name,
          path: files.get(declaration.fileRef)?.path, span: declaration.span, authored: false });
      }
    } else if (loaded.graph) {
      for (const node of loaded.graph.nodes.values()) entries.push({ sourceKey: source.key, revision: source.revision, recordId: node.id, kind: graphifyKind(node), title: node.label,
        name: node.label.replace(/\(\)$/, ''), ...(node.sourceFile ? { path: node.sourceFile } : {}), ...(node.line ? { line: node.line } : {}), authored: false, foreign: 'graphify' });
    }
  }
  return entries;
}

function candidate(entry, matchBasis) {
  return {
    ref: encodeReference({ sourceKey: entry.sourceKey, revision: shortRevision(entry.revision), recordId: entry.recordId, kind: entry.kind }),
    kind: entry.kind, title: entry.title, sourceKey: entry.sourceKey, matchBasis,
    ...(entry.authored ? { id: entry.displayId, ...(entry.workflowRef ? { workflowRef: entry.workflowRef } : {}), ...(entry.summary ? { summary: clip(entry.summary) } : {}) } : {}),
    ...(entry.path ? { location: { path: entry.path, ...(entry.span ? { startLine: entry.span.start.line, endLine: entry.span.end.line } : entry.line ? { startLine: entry.line } : {}) } } : {}),
    ...(entry.foreign ? { format: entry.foreign } : {}),
  };
}

function selectSources(discovery, selections) {
  const available = discovery.sources.filter(s => s.status === 'available' && READABLE_FORMATS.includes(s.format));
  if (!selections.length) return new Set(available.map(s => s.key));
  const keys = new Set();
  for (const selection of selections) {
    const matches = available.filter(s => s.key === selection || s.id === selection);
    if (!matches.length) throw Object.assign(new Error(`Unknown source "${selection}". Available: ${available.slice(0, 10).map(s => s.key).join(', ') || 'none'}.`), { status: 'invalid_request' });
    if (matches.length > 1 && !matches.some(s => s.key === selection)) throw Object.assign(new Error(`Source ID "${selection}" is ambiguous; use one key: ${matches.map(s => s.key).join(', ')}.`), { status: 'invalid_request' });
    keys.add((matches.find(s => s.key === selection) ?? matches[0]).key);
  }
  return keys;
}

function sourceLimitations(discovery, keys) {
  const graphify = discovery.sources.some(s => keys.has(s.key) && s.format === 'graphify') ? GRAPHIFY_LIMITATIONS : [];
  return [...graphify, ...discovery.sources.filter(s => keys.has(s.key) && s.freshness?.gitHead === 'differs-from-current-head')
    .map(source => `${source.key} was ${source.format === 'graphify' ? 'built' : 'scanned'} at a different commit than the current HEAD; its records may not describe the current code.`)];
}

const PLACEHOLDER = 9999999;
const measurementOf = (started, discovery, extra) => ({ totalMs: Date.now() - started, discoveryMs: discovery?.measurement.discoveryMs ?? null, sources: discovery?.measurement.available ?? 0, ...extra, outputBytes: PLACEHOLDER });

function finish(envelope, lists, budget, started, discovery, extra = {}) {
  envelope.measurement = measurementOf(started, discovery, extra);
  const packet = fitPacket(envelope, lists, budget);
  if (packet) { packet.measurement.outputBytes = packetBytes(packet); return packet; }

  const minimum = packetBytes({ ...envelope, ...Object.fromEntries(Object.keys(lists).map(key => [key, []])), budget: { maxOutputBytes: budget, truncated: false } });
  return budgetTooSmall({ scope: envelope.scope ? { project: envelope.scope.project } : undefined }, budget, minimum);
}

export function buildContext(options = {}) {
  const started = Date.now();
  const budget = validBudget(options.budget);
  const terms = contextTerms(options.terms ?? []);
  const locations = (options.at ?? []).map(value => { try { return parseLocation(value); } catch (error) { throw Object.assign(error, { status: 'invalid_request' }); } });
  if (!terms.length && !locations.length) throw Object.assign(new Error('context requires at least one --term or --at.'), { status: 'invalid_request' });
  if (locations.length > 20) throw Object.assign(new Error('Supply at most 20 --at locations.'), { status: 'invalid_request' });
  const discovery = discoverKnowledge({ project: options.project, cwd: options.cwd, workspace: options.workspace });
  const root = discovery.project.root;
  // Absolute locations inside the project become project-relative, like recorded paths.
  for (const location of locations) {
    const absolute = path.resolve(options.cwd ?? process.cwd(), location.path);
    if (path.isAbsolute(location.path) || fs.existsSync(absolute)) { const shown = displayPath(root, absolute); if (!path.isAbsolute(shown)) location.path = shown; }
  }
  const keys = selectSources(discovery, options.sources ?? []);
  const scope = { project: root, projectBasis: discovery.project.basis, ...(options.sources?.length ? { selectedSources: [...keys] } : {}) };
  const envelope = { protocolVersion: CONTEXT_PROTOCOL, status: '', request: { terms, at: locations.map(l => l.text) }, scope };
  // Selected sources plus problems worth knowing about; duplicates and layout copies are omitted.
  const sources = discovery.sources.filter(s => keys.has(s.key) || ['invalid', 'unsupported', 'unavailable', 'skipped'].includes(s.status)).map(publicSource);
  const limitations = ['Candidates are lexical matches over recorded names, paths and text, or recorded items at a location. They do not establish that a record explains the behavior.',
    'No runtime evidence was supplied; recorded connectivity and static references do not establish execution order.', ...sourceLimitations(discovery, keys)];

  if (!keys.size) {
    const unsupported = discovery.status === 'unsupported_input';
    envelope.status = unsupported ? 'unsupported_input' : 'no_context';
    limitations.push(unsupported ? 'Knowledge artifacts were found, but none are readable by this Waxwing version.' : 'No readable Waxwing models or source snapshots were found; absence of artifacts says nothing about the behavior.');
    envelope.searched = discovery.searched;
    return finish({ ...envelope, nextActions: [{ operation: 'use_normal_tools', reason: 'Continue the investigation with ordinary source search and runtime checks.' },
      { operation: 'scan', optional: true, arguments: [root, '<output outside the project>'], reason: 'Only when a bounded source index would help and the user authorized creating one.' }] },
    { limitations, sources }, budget, started, discovery);
  }

  const entries = knowledgeEntries(discovery, keys);
  const located = locations.flatMap(location => locateCandidates(entries, location));
  const lexical = terms.length ? matchCandidates(entries, terms, { limit: MAX_CANDIDATES }) : { total: 0, matches: [] };
  // Location results come first; a record found both ways appears once.
  const seen = new Set(), matches = [];
  for (const m of [...located, ...lexical.matches]) {
    const id = `${m.entry.sourceKey}\0${m.entry.recordId}`;
    if (seen.has(id)) { matches.find(x => `${x.entry.sourceKey}\0${x.entry.recordId}` === id).matchBasis.push(...m.matchBasis); continue; }
    seen.add(id); matches.push({ ...m, matchBasis: [...m.matchBasis] });
  }
  // Lexical matching may have stopped at its limit; count its unseen matches too.
  const total = matches.length + lexical.total - lexical.matches.length;
  if (!matches.length) {
    envelope.status = 'no_match';
    if (locations.length) limitations.push('No available source snapshot records a file at the requested location; the file may be outside the scan, or the path may need to be relative to the project.');
    if (terms.length) limitations.push('No recorded name, path or text matched; a miss is not proof that the behavior or code does not exist.');
    return finish({ ...envelope, nextActions: [{ operation: 'context', reason: 'Retry once with a name from vocabulary or from the code, or with a path:line found by searching.', options: { term: '<name>', at: '<path:line>' } },
      { operation: 'use_normal_tools', reason: 'Search the repository directly when no recorded item applies.' }] },
    { limitations, vocabulary: contextVocabulary(entries), sources }, budget, started, discovery, { matched: 0 });
  }
  const shown = matches.slice(0, MAX_CANDIDATES * 2);
  const counts = new Map();
  for (const m of shown) counts.set(m.entry.sourceKey, (counts.get(m.entry.sourceKey) ?? 0) + 1);
  const bySource = [...counts].map(([sourceKey, count]) => ({ sourceKey, shown: count }));
  const needsScope = !options.sources?.length && bySource.length > 1 && lexical.total > MAX_CANDIDATES;
  envelope.status = needsScope ? 'needs_scope' : 'context_found';
  envelope.matched = { total, shownBeforeBudget: shown.length, bySource };
  if (needsScope) limitations.push(`Matches span ${bySource.length} sources and exceed ${MAX_CANDIDATES} candidates; select one with --source or use a more specific term.`);
  const candidates = shown.map(m => candidate(m.entry, m.matchBasis));
  const nextActions = [...candidates.slice(0, 3).map(c => ({ operation: 'read', arguments: [c.ref] })),
    ...(needsScope ? bySource.map(s => ({ operation: 'context', options: { source: s.sourceKey } })) : [])];
  return finish({ ...envelope, nextActions }, { limitations, candidates, sources }, budget, started, discovery, { matched: total });
}

// ---- Progressive reads ----------------------------------------------------

function viewLinks(root, loaded, target) {
  const links = [];
  for (const directory of loaded.sites ?? []) {
    try {
      const url = siteTargetURL(loaded.model, target, 'index.html');
      const [page, fragment] = url.split('#');
      const file = path.join(directory, page || 'index.html');
      if (!fs.existsSync(file)) continue;
      links.push({ kind: 'site-page', path: displayPath(root, file), ...(fragment ? { fragment: decodeURIComponent(fragment) } : {}), url: pathToFileURL(file).href + (fragment ? `#${fragment}` : '') });
    } catch { /* This record has no unambiguous page in that site. */ }
  }
  return links;
}

function modelRead(root, source, loaded, decoded, options) {
  const model = loaded.model, entries = modelRecords(model);
  const [workflowRef, displayId] = decoded.kind === 'step' ? JSON.parse(decoded.recordId) : [undefined, decoded.recordId];
  const found = entries.find(e => e.kind === decoded.kind && e.record.id === displayId && (decoded.kind !== 'step' || e.workflowRef === workflowRef));
  if (!found) return null;
  const refFor = (kind, id, scope) => encodeReference({ sourceKey: source.key, revision: shortRevision(source.revision), recordId: kind === 'step' ? stepId(scope, id) : id, kind });
  const related = [], lists = {};
  let record = found.record;
  if (decoded.kind === 'document') {
    const { markdown, links: _links, ...header } = record;
    const lines = (markdown ?? '').split('\n'), from = Math.max(1, options.fromLine ?? 1);
    record = { ...header, range: { startLine: from, totalLines: lines.length } };
    lists.lines = lines.slice(from - 1);
  }
  if (found.kind === 'component' && model.diagramType !== 'sequence') {
    for (const relationship of model.relationships.filter(r => r.from === displayId || r.to === displayId)) {
      related.push({ ref: refFor('relationship', relationship.id), kind: 'relationship', title: relationship.label ?? relationship.id, direction: relationship.from === displayId ? 'outgoing' : 'incoming', relation: relationship.kind, other: relationship.from === displayId ? relationship.to : relationship.from });
    }
  }
  if (found.kind === 'component') {
    for (const workflow of model.workflows ?? []) if (workflow.steps.some(s => s.from === displayId || s.to === displayId)) related.push({ ref: refFor('workflow', workflow.id), kind: 'workflow', title: workflow.title ?? workflow.id });
  }
  if (found.kind === 'relationship') for (const end of [record.from, record.to]) related.push({ ref: refFor('component', end), kind: 'component', title: entries.find(e => e.record.id === end)?.record.label ?? end });
  if (found.kind === 'workflow') for (const step of record.steps) related.push({ ref: refFor('step', step.id, record.id), kind: 'step', title: step.label ?? step.id });
  const sourceRefs = new Set();
  const walk = value => { if (!value || typeof value !== 'object') return; (value.sourceRefs ?? []).forEach(ref => sourceRefs.add(ref)); Object.values(value).forEach(walk); };
  walk(found.record);
  const evidence = (model.sources ?? []).filter(s => sourceRefs.has(s.id)).map(s => ({ ...s, verification: 'recorded-locator-not-checked' }));
  const target = decoded.kind === 'component' ? { kind: 'node', ref: displayId } : decoded.kind === 'step' ? { kind: 'step', ref: displayId, workflowRef } : ['relationship', 'workflow', 'document', 'graph'].includes(decoded.kind) ? { kind: decoded.kind, ref: displayId } : null;
  return { record: { kind: found.kind, ...(workflowRef ? { workflowRef } : {}), value: record }, lists: { ...lists, related, evidence },
    views: target ? viewLinks(root, loaded, target) : [], semantics: 'Recorded model knowledge with its own qualifications; not proof that the claim is currently true.',
    continuation: decoded.kind === 'document' ? 'lines' : null };
}

function sourceRootFor(root, discovery, snapshot, options) {
  if (options.sourceRoot !== undefined) return { directory: path.resolve(options.cwd ?? process.cwd(), options.sourceRoot), mapping: 'command-line --source-root' };
  if (discovery.sourceRoots[snapshot.source.id]) return { directory: discovery.sourceRoots[snapshot.source.id], mapping: `.waxwing/config.json sourceRoots.${snapshot.source.id}` };
  return { directory: root, mapping: 'project root (accepted only when file bytes match the recorded digest)' };
}

function sourceRead(root, discovery, source, loaded, decoded, options) {
  const snapshot = loaded.snapshot;
  const files = new Map(snapshot.files.map(f => [f.id, f]));
  const declarations = new Map(snapshot.declarations.map(d => [d.id, d]));
  const record = files.get(decoded.recordId) ?? declarations.get(decoded.recordId) ?? snapshot.references.find(r => r.id === decoded.recordId);
  if (!record) return null;
  const file = record.path !== undefined ? record : files.get(record.fileRef);
  const refFor = item => encodeReference({ sourceKey: source.key, revision: shortRevision(source.revision), recordId: item.id, kind: item.path !== undefined ? 'file' : declarations.has(item.id) ? item.kind : 'reference' });
  const describe = item => ({ ref: refFor(item), kind: item.path !== undefined ? 'file' : item.kind, title: item.name ?? item.path, ...(item.span ? { location: { path: files.get(item.fileRef)?.path, startLine: item.span.start.line, endLine: item.span.end.line } } : {}), ...(item.resolution ? { resolution: item.resolution.status } : {}) });
  const related = [];
  if (record.path !== undefined) {
    related.push(...snapshot.declarations.filter(d => d.fileRef === record.id && ['function', 'method', 'class', 'interface'].includes(d.kind)).map(describe));
  } else if (declarations.has(record.id)) {
    const navigation = sourceNavigation(snapshot);
    related.push(...snapshot.references.filter(r => r.resolution.targets.includes(record.id)).slice(0, 20).map(r => ({ ...describe(r), relation: 'incoming-reference' })));
    if (['function', 'method'].includes(record.kind)) related.push(...navigation.relationships.filter(r => r.callerRef === record.id && ['call', 'construct'].includes(r.reference.kind)).slice(0, 20).map(r => ({ ...describe(r.reference), relation: 'outgoing-occurrence' })));
  } else {
    related.push(...record.resolution.targets.map(id => files.get(id) ?? declarations.get(id)).filter(Boolean).map(item => ({ ...describe(item), relation: `resolution-${record.resolution.status}` })));
  }
  const excerpt = { path: file.path, verification: 'not-attempted' };
  let lines = [];
  if (file.status !== 'analyzed') Object.assign(excerpt, { verification: 'unavailable', reason: `File was skipped by the scan: ${file.reason}.` });
  else {
    const mapping = sourceRootFor(root, discovery, snapshot, options);
    const window = text => {
      const all = text.split(/\r?\n/), context = options.contextLines ?? 3;
      const first = options.fromLine ?? (record.span ? Math.max(1, record.span.start.line - context) : 1);
      const last = record.span && options.fromLine === undefined ? Math.min(all.length, record.span.end.line + context) : all.length;
      lines = all.slice(first - 1, last);
      return { startLine: first, requestedEndLine: last, totalLines: all.length };
    };
    let directory;
    try {
      directory = fs.realpathSync(mapping.directory);
      const text = readVerifiedSourceText(directory, file);
      Object.assign(excerpt, { verification: 'source-byte-verified', mapping: mapping.mapping, contentDigest: file.contentDigest, ...window(text) });
    } catch (error) {
      const reason = ['changed-bytes', 'changed-text-length'].includes(error.message) ? 'changed' : error.code === 'ENOENT' ? 'unavailable' : error.message === 'symlink' ? 'symlink' : error.code ?? error.message;
      let current = null;
      // A changed file still helps during active editing; its lines are labeled, never verified.
      if (reason === 'changed') { try { current = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(path.join(directory, file.path))); } catch { current = null; } }
      if (current !== null) {
        Object.assign(excerpt, { verification: 'unverified-current-file', mapping: mapping.mapping, ...window(current),
          reason: 'Current bytes differ from the scanned file. These are the current lines at the recorded location; the declaration may have moved or changed.',
          recovery: 'Rescan into a new snapshot to verify locations again.' });
      } else {
        Object.assign(excerpt, { verification: reason, mapping: mapping.mapping, reason: reason === 'changed' ? 'Current bytes differ from the scanned file and could not be read as text.' : 'Source bytes could not be read at the mapped root.',
          recovery: reason === 'changed' ? 'Rescan into a new snapshot, or read the file directly while treating the recorded span as historical.' : 'Pass --source-root for the scanned tree or add .waxwing/config.json sourceRoots.' });
      }
    }
  }
  const views = [];
  if (path.basename(loaded.filename) === 'snapshot.json' && fs.existsSync(path.join(path.dirname(loaded.filename), '../waxwing-site.json'))) {
    const page = path.join(path.dirname(loaded.filename), 'index.html');
    if (fs.existsSync(page)) views.push({ kind: 'source-explorer', path: displayPath(root, page), fragment: record.id, url: `${pathToFileURL(page).href}#${encodeURIComponent(record.id)}` });
  }
  return { record: { kind: record.path !== undefined ? 'file' : declarations.has(record.id) ? record.kind : 'reference', value: record, excerpt }, lists: { lines, related }, views,
    semantics: 'Static source occurrences within one snapshot. Candidate targets are not resolved calls or proof of runtime execution.', continuation: 'lines' };
}

// Graphify nodes carry a file and start line but no digest: excerpts are current file lines, never verified.
function graphifyRead(root, source, loaded, decoded, options) {
  const { nodes, edges } = loaded.graph;
  const node = nodes.get(decoded.recordId);
  if (!node) return null;
  const refFor = other => encodeReference({ sourceKey: source.key, revision: shortRevision(source.revision), recordId: other.id, kind: graphifyKind(other) });
  const describe = (edge, direction) => {
    const other = nodes.get(direction === 'outgoing' ? edge.to : edge.from);
    return { ref: refFor(other), kind: graphifyKind(other), title: other.label, direction, relation: edge.relation, ...(edge.confidence ? { confidence: edge.confidence } : {}),
      ...(edge.context ? { context: edge.context } : {}), ...(other.sourceFile ? { location: { path: other.sourceFile, ...(other.line ? { startLine: other.line } : {}) } } : {}),
      ...(edge.sourceFile ? { evidence: { path: edge.sourceFile, ...(edge.line ? { line: edge.line } : {}) } } : {}), edgeDirection: edge.direction };
  };
  const related = [...edges.filter(e => e.from === node.id).slice(0, 40).map(e => describe(e, 'outgoing')), ...edges.filter(e => e.to === node.id).slice(0, 40).map(e => describe(e, 'incoming'))];
  const { raw, pathUsable, ...fields } = node;
  const excerpt = { verification: 'not-attempted' };
  let lines = [];
  if (!node.sourceFile) excerpt.reason = 'Graphify recorded no source file for this node.';
  else {
    Object.assign(excerpt, { path: node.sourceFile });
    const directory = options.sourceRoot !== undefined ? path.resolve(options.cwd ?? process.cwd(), options.sourceRoot) : root;
    let relative = node.sourceFile;
    if (path.isAbsolute(relative)) { const shown = displayPath(root, relative); relative = path.isAbsolute(shown) ? null : shown; }
    try {
      if (!relative || !pathUsable && relative === node.sourceFile) throw new Error('unusable-path');
      let current = fs.realpathSync(directory);
      for (const part of relative.split('/')) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) throw new Error('symlink'); }
      const all = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(current)).split(/\r?\n/), context = options.contextLines ?? 3;
      const first = options.fromLine ?? Math.max(1, (node.line ?? 1) - context);
      const last = options.fromLine === undefined && node.line ? Math.min(all.length, (node.endLine ?? node.line) + Math.max(context, 30)) : all.length;
      lines = all.slice(first - 1, last);
      Object.assign(excerpt, { verification: 'unverified-current-file', mapping: options.sourceRoot !== undefined ? 'command-line --source-root' : 'project root', startLine: first, requestedEndLine: last, totalLines: all.length,
        reason: 'Graphify records a start line but no content digest or end line. These are current file lines at and after that location.' });
    } catch (error) {
      Object.assign(excerpt, { verification: 'unavailable', reason: `Source file could not be read at the mapped root: ${error.code ?? error.message}.`, recovery: 'Pass --source-root for the directory Graphify was run on.' });
    }
  }
  return { record: { kind: graphifyKind(node), format: 'graphify', value: fields, graphify: raw, excerpt }, lists: { lines, related }, views: [],
    semantics: 'An imported Graphify node and its recorded relationships. Relations and confidence are Graphify’s extraction claims, not verified behavior or execution order.', continuation: 'lines' };
}

export function readReference(reference, options = {}) {
  const started = Date.now();
  const budget = validBudget(options.budget);
  if (options.fromLine !== undefined && (!Number.isInteger(options.fromLine) || options.fromLine < 1)) throw Object.assign(new Error('--from-line must be a positive integer.'), { status: 'invalid_request' });
  if (options.contextLines !== undefined && (!Number.isInteger(options.contextLines) || options.contextLines < 0 || options.contextLines > 200)) throw Object.assign(new Error('--context-lines must be an integer from 0 to 200.'), { status: 'invalid_request' });
  let decoded;
  try { decoded = decodeReference(reference); } catch (error) { throw Object.assign(error, { status: 'invalid_request' }); }
  const discovery = discoverKnowledge({ project: options.project, cwd: options.cwd, workspace: options.workspace });
  const root = discovery.project.root;
  const envelope = { protocolVersion: CONTEXT_PROTOCOL, status: '', reference, scope: { project: root, projectBasis: discovery.project.basis } };
  const source = discovery.sources.find(s => s.key === decoded.sourceKey && s.status === 'available');
  const stale = (message, extra = {}) => finish({ ...envelope, status: 'stale_reference', message, ...extra,
    nextActions: [...(extra.currentRef ? [{ operation: 'read', arguments: [extra.currentRef] }] : []), { operation: 'context', reason: 'Repeat the context request against the current artifacts.' }] }, {}, budget, started, discovery);
  if (!source) return stale(`Source ${decoded.sourceKey} is no longer available in this project scope.`);
  const loaded = discovery.loaded.get(source.key);
  const read = loaded.model ? modelRead(root, source, loaded, decoded, options) : loaded.graph ? graphifyRead(root, source, loaded, decoded, options) : sourceRead(root, discovery, source, loaded, decoded, options);
  if (shortRevision(source.revision) !== decoded.revision) {
    return stale(`${source.key} changed since this reference was issued (revision ${decoded.revision} → ${shortRevision(source.revision)}).`,
      read ? { currentRef: encodeReference({ ...decoded, revision: shortRevision(source.revision) }) } : {});
  }
  if (!read) return stale(`Record not found in ${source.key}.`);
  envelope.status = 'record_found';
  envelope.source = publicSource(source);
  envelope.record = read.record;
  envelope.views = read.views;
  envelope.semantics = read.semantics;
  // Size-bearing fields are reserved with maximal placeholders, then filled after fitting.
  const lineRange = record => read.continuation !== 'lines' ? null : record.excerpt?.startLine !== undefined ? record.excerpt : record.value?.range ?? null;
  const reserved = lineRange(envelope.record);
  if (reserved) { reserved.endLine = PLACEHOLDER; envelope.nextActions = [{ operation: 'read', arguments: [reference], options: { fromLine: PLACEHOLDER } }]; }
  const packet = finish(envelope, read.lists, budget, started, discovery);
  if (packet.status !== 'record_found') return packet;
  const range = lineRange(packet.record);
  if (range) {
    if (packet.budget.omitted?.lines && !packet.lines.length) return budgetTooSmall({ reference }, budget, packetBytes(packet) + Buffer.byteLength(JSON.stringify(read.lists.lines[0])) + 1);
    range.endLine = range.startLine + packet.lines.length - 1;
    if (packet.budget.omitted?.lines) packet.nextActions[0].options.fromLine = range.endLine + 1;
    else delete packet.nextActions;
  }
  packet.measurement.outputBytes = packetBytes(packet);
  return packet;
}

export function discoverReport(options = {}) {
  const started = Date.now();
  const budget = validBudget(options.budget);
  const discovery = discoverKnowledge({ project: options.project, cwd: options.cwd, workspace: options.workspace });
  const sources = discovery.sources.map(publicSource);
  return finish({ protocolVersion: CONTEXT_PROTOCOL, status: discovery.status, scope: { project: discovery.project.root, projectBasis: discovery.project.basis }, searched: discovery.searched,
    semantics: 'Discovered data sources only. Discovery does not establish relevance, authority or current behavior.',
    nextActions: discovery.status === 'sources_found' ? [{ operation: 'context', options: { term: '<name>', at: '<path:line>' } }] : [{ operation: 'use_normal_tools' }] },
  { sources, diagnostics: discovery.diagnostics }, budget, started, discovery);
}

export { resolveProject };
