import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import { analyzeSources } from '../modules/analysis/index.mjs';
import { sourceNavigation } from '../modules/knowledge/source/navigation.mjs';
import { sourceNeighborhood } from '../modules/knowledge/source/neighborhood.mjs';
import { renderSourceHTML } from '../modules/presentation/source/index.mjs';

const sources = [
  { path: 'lib.mjs', content: 'export function run() {}' },
  { path: 'app.mjs', content: "import fs from 'node:fs';\nexport async function boot() {\n  const {run: local} = await import('./lib.mjs');\n  local();\n  missing();\n}\n" },
];
const fixture = () => analyzeSources(sources);
const sourceData = html => JSON.parse(html.match(/<script type="application\/json" id="source-data">(.*?)<\/script>/s)[1]);
// Execute the bundled renderer with a small DOM surface. This checks navigation,
// source excerpts and context at the actual UI output boundary, without running
// the inspected project or relying on snapshots of implementation strings.
function renderPage(html, hash, search = '') {
  const elements = new Map(['detail', 'navigation', 'search', 'show-skipped'].map(id => [id, { innerHTML: '', value: '', checked: false, addEventListener() {}, querySelector() { return null; } }]));
  elements.set('source-data', { textContent: JSON.stringify(sourceData(html)) });
  const script = html.match(/<script>(.*?)<\/script>/s)[1];
  vm.runInNewContext(script, { URLSearchParams, document: { getElementById: id => elements.get(id) }, window: { location: { hash: `#${hash}`, search }, addEventListener() {} } });
  return elements.get('detail').innerHTML;
}

test('focused source graph keeps lexical binding separate from exported origin and unresolved calls', async () => {
  const snapshot = await fixture(), nav = sourceNavigation(snapshot);
  const boot = snapshot.declarations.find(d => d.name === 'boot'), local = snapshot.declarations.find(d => d.name === 'local'), run = snapshot.declarations.find(d => d.name === 'run');
  const graph = sourceNeighborhood(nav, boot.id);
  assert.equal(graph.focusRef, boot.id);
  assert.ok(graph.edges.some(edge => edge.from === boot.id && edge.to === local.id && edge.kind === 'binding'));
  assert.ok(graph.edges.some(edge => edge.from === local.id && edge.to === run.id && edge.kind === 'provenance'));
  assert.ok(!graph.edges.some(edge => edge.from === boot.id && edge.to === run.id));
  assert.ok(graph.nodes.some(node => node.label === 'missing' && node.boundary === 'unresolved' && !node.recordRef));
  assert.ok(graph.edges.every(edge => snapshot.references.some(reference => reference.id === edge.referenceRef)));
  const moduleGraph = sourceNeighborhood(nav, boot.fileRef);
  assert.ok(moduleGraph.nodes.some(node => node.label === 'node:fs' && node.boundary === 'external'));
  const html = renderSourceHTML(snapshot, { sourceTexts: Object.fromEntries(snapshot.files.map(file => [file.id, sources.find(source => source.path === file.path).content])) });
  const page = renderPage(html, boot.id);
  assert.match(page, /<svg class="source-graph"/);
  assert.match(page, /Static value origin/);
  assert.match(page, /Verified source bytes/);
  assert.match(page, /missing\(\);/);
  assert.match(page, /do not establish runtime dispatch/);
});

test('neighborhood limits report hidden occurrences and cap ambiguous target fanout', async () => {
  const snapshot = await fixture(), nav = sourceNavigation(snapshot), boot = snapshot.declarations.find(d => d.name === 'boot');
  const limited = sourceNeighborhood(nav, boot.id, { limit: 1 });
  assert.equal(limited.totalRelationships, 2);
  assert.equal(limited.omittedRelationships, 1);
  assert.ok(limited.nodes.length <= 5);
  const ref = nav.relationships.find(item => item.reference.kind === 'call');
  ref.reference.resolution = { status: 'ambiguous', reason: 'candidate-binding', targets: Array.from({ length: 90 }, (_, index) => `candidate-${index}`) };
  ref.provenance = [];
  const candidates = sourceNeighborhood(nav, boot.id, { limit: 1 });
  assert.ok(candidates.nodes.length <= 5);
  assert.equal(candidates.omittedNodes, 86);
  assert.ok(candidates.nodes.filter(node => node.role !== 'focus').every(node => node.boundary === 'candidate'));
  assert.throws(() => sourceNeighborhood(nav, boot.id, { limit: 0 }), /limit/);
});

test('source excerpts require exact hashes and lengths; hostile text and context remain inert', async () => {
  const snapshot = await analyzeSources([{ path: 'hostile.mjs', content: '// </script><img src=x onerror=alert(1)>\nexport const label = "name";\n' }]);
  const file = snapshot.files[0], entry = snapshot.declarations.find(d => d.name === 'label');
  const sourceTexts = { [file.id]: '// </script><img src=x onerror=alert(1)>\nexport const label = "name";\n' };
  assert.throws(() => renderSourceHTML(snapshot, { sourceTexts: { [file.id]: sourceTexts[file.id] + ' ' } }), /does not match snapshot bytes/);
  assert.throws(() => renderSourceHTML(snapshot, { sourceTexts: { unknown: 'anything' } }), /analyzed file/);
  const connection = { id: 'test-link', subject: { kind: 'node', ref: 'component' }, entryRef: entry.id, evidenceRefs: [], label: '<script>unsafe</script>', subjectLabel: 'Example component', basis: { status: 'inferred', explanation: 'An explicit mapping for this example.', sourceRefs: ['design'] }, rationale: [{ id: 'why', statement: 'Why this boundary?', answer: { status: 'unknown', reason: 'The intention has not been recorded.' } }], sources: [{ id: 'design', kind: 'documentation', description: 'A design note', locator: 'docs/design.md' }], returnURL: '../graphs/overview.html#record-component' };
  const html = renderSourceHTML(snapshot, { sourceTexts, connections: [connection] });
  assert.ok(!html.includes('</script><img'));
  const page = renderPage(html, entry.id, '?context=test-link');
  assert.match(page, /Return to overview/);
  assert.match(page, /href="\.\.\/graphs\/overview.html#record-component"/);
  assert.match(page, /Recorded rationale/);
  assert.match(page, /The intention has not been recorded/);
  assert.match(page, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.ok(!page.includes('<img'));
  assert.match(renderPage(html, entry.id), /Connected explanations/);
  assert.match(renderPage(html, entry.id, '?context=missing'), /explore the source independently/);
  for (const returnURL of ['javascript:alert(1)', '//evil.test', '\\evil.test', '../%2f/evil.test', 'data:text/html,hello']) assert.throws(() => renderSourceHTML(snapshot, { connections: [{ ...connection, returnURL }] }), /safe relative URL/);
});

test('mapped identifier evidence can be opened even when it is not a call or import', async () => {
  const snapshot = await analyzeSources([{ path: 'evidence.mjs', content: 'export const answer = 42; export const other = answer;' }]);
  const reference = snapshot.references.find(r => r.kind === 'reference' && r.name === 'answer');
  assert.ok(reference);
  const entry = snapshot.declarations.find(d => d.name === 'other');
  const connection = { id: 'evidence-link', entryRef: entry.id, evidenceRefs: [reference.id], label: 'Evidence', subjectLabel: 'A component', basis: { status: 'established', explanation: 'Explicit identifier use.', sourceRefs: [] }, rationale: [], sources: [], returnURL: '../index.html' };
  const html = renderSourceHTML(snapshot, { connections: [connection] });
  assert.ok(sourceData(html).references.some(record => record.id === reference.id));
  const page = renderPage(html, reference.id, '?context=evidence-link');
  assert.match(page, /Compiler binding/);
  assert.match(page, /Source evidence/);
  assert.ok(!page.includes('Record not in this snapshot'));
});

test('verified excerpts use compiler line boundaries for Unicode separators', async () => {
  const content = '// first line\u2028export function unicode() {\u2029  return 1;\r\n}\n';
  const snapshot = await analyzeSources([{ path: 'unicode.mjs', content }]);
  const declaration = snapshot.declarations.find(d => d.name === 'unicode');
  assert.equal(declaration.span.start.line, 2);
  const html = renderSourceHTML(snapshot, { sourceTexts: { [snapshot.files[0].id]: content } });
  const page = renderPage(html, declaration.id);
  assert.match(page, /aria-hidden="true">2<\/span><code>export function unicode/);
  assert.match(page, /aria-hidden="true">3<\/span><code>  return 1;/);
  assert.match(page, /aria-hidden="true">4<\/span><code>}/);
});

test('a contextual incoming occurrence remains visible beside a busy callable', async () => {
  const snapshot = await analyzeSources([{ path: 'busy.mjs', content: `export function busy() { ${Array.from({ length: 15 }, (_, i) => `unknown${i}();`).join(' ')} } export function caller() { busy(); }` }]);
  const nav = sourceNavigation(snapshot), busy = snapshot.declarations.find(record => record.name === 'busy'), caller = snapshot.declarations.find(record => record.name === 'caller');
  const incoming = nav.relationships.find(item => item.callerRef === caller.id);
  const ordinary = sourceNeighborhood(nav, busy.id);
  assert.ok(!ordinary.edges.some(edge => edge.referenceRef === incoming.reference.id));
  const contextual = sourceNeighborhood(nav, busy.id, { preferredReferenceRefs: [incoming.reference.id, 'not-relevant'] });
  assert.ok(contextual.edges.some(edge => edge.referenceRef === incoming.reference.id && edge.from === caller.id && edge.to === busy.id));
  assert.equal(contextual.totalRelationships, ordinary.totalRelationships);
  assert.equal(contextual.omittedRelationships, ordinary.omittedRelationships);
  assert.equal(contextual.edges[0].referenceRef, incoming.reference.id);
});
