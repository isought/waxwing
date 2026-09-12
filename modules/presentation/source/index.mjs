import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { sourceNavigation } from '../../knowledge/source/navigation.mjs';
import { readingProjection } from './reading.mjs';
import { visitReadingTrail, prioritizeReadingEdges, readingRecordLabel } from './history.mjs';
import { sourceNeighborhood } from '../../knowledge/source/neighborhood.mjs';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const relativeURL = value => typeof value === 'string' && value.length > 0 && !/^[\/\\]|^[a-z][a-z\d+.-]*:|[\\\u0000-\u0020\u007f]/i.test(value) && !/%(?:0[0-9a-f]|1[0-9a-f]|7f|5c|2f)/i.test(value);

export function renderSourceHTML(snapshot, options = {}) {
  if (!object(options) || Object.keys(options).some(key => !['sourceTexts', 'connections', 'bridgeDiagnostics', 'evidenceDiagnostics'].includes(key))) throw new Error('Invalid source view options.');
  const data = sourceNavigation(snapshot);
  const files = new Map(snapshot.files.map(file => [file.id, file]));
  const sourceTexts = options.sourceTexts ?? {};
  if (!object(sourceTexts)) throw new Error('sourceTexts must map analyzed file identities to source text.');
  for (const [id, text] of Object.entries(sourceTexts)) {
    const file = files.get(id);
    if (file?.status !== 'analyzed' || typeof text !== 'string') throw new Error(`Source text requires an analyzed file: ${id}`);
    if (createHash('sha256').update(text, 'utf8').digest('hex') !== file.contentDigest || Buffer.byteLength(text, 'utf8') !== file.byteLength || text.length !== file.textLength) throw new Error(`Source text does not match snapshot bytes: ${file.path}`);
  }
  const connections = options.connections ?? [], diagnostics = options.bridgeDiagnostics ?? [], evidenceDiagnostics = options.evidenceDiagnostics ?? [];
  if (!Array.isArray(connections) || !Array.isArray(diagnostics) || !Array.isArray(evidenceDiagnostics)) throw new Error('Source connections and diagnostics must be arrays.');
  const records = new Map([...snapshot.files, ...snapshot.declarations, ...snapshot.references].map(record => [record.id, record]));
  const ids = new Set();
  for (const connection of connections) {
    if (!object(connection) || typeof connection.id !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(connection.id) || ids.has(connection.id) || !records.has(connection.entryRef) || !Array.isArray(connection.evidenceRefs) || connection.evidenceRefs.some(id => !records.has(id))) throw new Error('Invalid projected source connection.');
    if (!relativeURL(connection.returnURL)) throw new Error('Source connection returnURL must be a safe relative URL.');
    ids.add(connection.id);
  }
  // Ordinary identifiers can be bridge evidence even though navigation normally
  // focuses on calls and imports. Keep every explicitly referenced occurrence.
  const extraRefs = new Set(connections.flatMap(connection => [connection.entryRef, ...connection.evidenceRefs]));
  data.references = snapshot.references.filter(reference => extraRefs.has(reference.id));
  data.sourceTexts = structuredClone(sourceTexts);
  data.connections = structuredClone(connections);
  data.bridgeDiagnostics = structuredClone(diagnostics);
  data.evidenceDiagnostics = structuredClone(evidenceDiagnostics);
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const asset = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(data.source.id)} · Source explorer</title><style>${asset('viewer.css')}</style></head>
<body><header><a href="#" class="brand">Waxwing <span>Source explorer</span></a><span class="repository-name">${escape(data.source.id)}</span></header>
<div class="shell"><aside><label for="search">Find a file or function</label><input id="search" aria-label="Find a file or function" type="search" placeholder="Path or function name" autocomplete="off"><label class="toggle"><input id="show-skipped" type="checkbox"> Include skipped files</label><details id="file-browser" class="file-browser" open><summary>Browse files & functions</summary><nav id="navigation" aria-label="Source files and functions"></nav></details></aside>
<main id="detail" tabindex="-1"></main></div><script type="application/json" id="source-data">${json}</script><script>${[sourceNeighborhood, readingProjection, visitReadingTrail, prioritizeReadingEdges, readingRecordLabel].map(fn => fn.toString()).join('\n')}\n${asset('viewer.js')}</script></body></html>`;
}
