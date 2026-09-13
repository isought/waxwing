import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildContext, discoverReport, readReference } from '../modules/application/context.mjs';
import { discoverKnowledge } from '../modules/application/discover.mjs';
import { scanRepositoryToFile } from '../modules/application/scan.mjs';
import { buildSiteFiles } from '../modules/application/pipeline.mjs';
import { decodeReference, encodeReference } from '../modules/knowledge/context/protocol.mjs';
import { contextTerms } from '../modules/knowledge/context/match.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/waxwing.mjs');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'waxwing context '));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const run = (cwd, args, env = {}) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
const bytes = packet => Buffer.byteLength(JSON.stringify(packet) + '\n');
function snapshotOf(dir) {
  const result = {};
  const visit = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const file = path.join(current, entry.name), stat = fs.lstatSync(file);
      if (entry.isDirectory()) visit(file, `${prefix}${entry.name}/`);
      else result[prefix + entry.name] = `${stat.mtimeMs}:${fs.readFileSync(file, 'latin1')}`;
    }
  };
  visit(dir, '');
  return result;
}

const graphify = JSON.stringify({ directed: false, multigraph: false, graph: {}, nodes: [{ label: 'client.py', file_type: 'code', source_file: 'client.py', source_location: 'L1', id: 'client' }],
  links: [{ relation: 'imports_from', confidence: 'EXTRACTED', _src: 'client', _tgt: 'models', source: 'client', target: 'models' }] });

// A shared fixture: a Git project with source, a model with a built site, and an external scan.
async function fixture() {
  const base = temp();
  const project = path.join(base, 'checkout app'), knowledge = path.join(base, 'knowledge');
  fs.mkdirSync(project);
  spawnSync('git', ['init', '-q'], { cwd: project });
  write(path.join(project, 'src/checkout.ts'), [
    'export class CheckoutService {',
    '  status(order: { paid: boolean }) {',
    "    return order.paid ? 'complete' : 'pending';",
    '  }',
    '}',
    '',
  ].join('\n'));
  write(path.join(project, 'src/legacy/checkout.ts'), 'export function CheckoutService() {\n  return null;\n}\n');
  write(path.join(project, 'src/main.ts'), "import { CheckoutService } from './checkout.js';\nnew CheckoutService().status({ paid: false });\n");
  fs.cpSync(path.join(root, 'examples/multi-page'), path.join(project, 'docs/system'), { recursive: true, filter: source => !source.includes(`${path.sep}generated`) });
  await buildSiteFiles(path.join(project, 'docs/system/model.json'), path.join(project, 'docs/system/site'));
  await scanRepositoryToFile(project, path.join(knowledge, 'scan.json'), { sourceId: 'checkout-app' });
  write(path.join(project, '.waxwing/config.json'), JSON.stringify({ schemaVersion: '0.1-project-config', artifacts: [path.join(knowledge, 'scan.json')] }));
  return { base, project, knowledge };
}

test('question terms keep clues, identifiers and ordinary words distinct', () => {
  const terms = contextTerms('Why does `querySourceSnapshot` return empty for src/app.ts and user_id in PaymentGateway?', ['E_TIMEOUT']);
  assert.deepEqual(terms.filter(t => t.origin !== 'word').map(t => `${t.origin}:${t.text}`), ['clue:E_TIMEOUT', 'identifier:querySourceSnapshot', 'identifier:src/app.ts', 'identifier:user_id', 'identifier:PaymentGateway']);
  assert.ok(terms.some(t => t.origin === 'word' && t.text === 'empty'));
  assert.ok(!terms.some(t => ['why', 'does', 'return'].includes(t.text)));
  assert.throws(() => contextTerms(''), /nonempty --question/);
  assert.throws(() => contextTerms('q', Array(21).fill('x')), /at most 20 clues/);
});

test('references are opaque, integrity-checked and revision-bound', () => {
  const ref = encodeReference({ sourceKey: 'docs/a b.json', revision: 'abc', recordId: 'id "quoted"', kind: 'component' });
  assert.match(ref, /^wx1\.[A-Za-z0-9_-]+\.[a-f0-9]{12}$/);
  assert.deepEqual(decodeReference(ref), { sourceKey: 'docs/a b.json', revision: 'abc', recordId: 'id "quoted"', kind: 'component' });
  const [, body, check] = ref.split('.');
  assert.throws(() => decodeReference(`wx1.${body}.${check.replace(/.$/, c => c === '0' ? '1' : '0')}`), /Corrupted/);
  assert.throws(() => decodeReference('rm -rf /'), /Unrecognized/);
});

test('discovery covers native, Graphify-only, both and neither without writing to the project', async () => {
  const { base, project } = await fixture();
  const empty = path.join(base, 'empty'), foreign = path.join(base, 'foreign');
  try {
    write(path.join(empty, 'package.json'), '{"name":"not-knowledge"}');
    write(path.join(foreign, 'graphify-out/graph.json'), graphify);
    write(path.join(project, 'graphify-out/graph.json'), graphify);
    write(path.join(project, 'broken/model.json'), '{"schemaVersion":"0.5-draft","id":"broken"}');
    const before = snapshotOf(project);
    const report = discoverReport({ project });
    assert.equal(report.status, 'sources_found');
    const byKey = Object.fromEntries(report.sources.map(s => [s.key, s]));
    assert.equal(byKey['docs/system/model.json'].status, 'available');
    assert.deepEqual(byKey['docs/system/model.json'].views.map(v => v.site), ['docs/system/site']);
    assert.equal(byKey['docs/system/site/source/model.json'].status, 'duplicate');
    assert.equal(byKey['docs/system/site/source/layout.json'].status, 'not-indexed', 'layout JSON embeds a model but is not a second model source');
    const scan = report.sources.find(s => s.format === 'waxwing-source-snapshot');
    assert.equal(scan.status, 'available');
    assert.ok(path.isAbsolute(scan.key), 'external artifact keeps an absolute location');
    assert.equal(scan.registration, '.waxwing/config.json artifacts');
    assert.equal(byKey['graphify-out/graph.json'].format, 'graphify');
    assert.equal(byKey['graphify-out/graph.json'].status, 'unsupported');
    assert.equal(byKey['broken/model.json'].status, 'invalid');
    assert.ok(bytes(report) <= 16384);
    assert.deepEqual(snapshotOf(project), before, 'read-only commands leave project bytes and mtimes unchanged');

    assert.equal(discoverReport({ project: foreign }).status, 'unsupported_input');
    const none = buildContext({ project: empty, question: 'Why does checkout hang?' });
    assert.equal(none.status, 'no_context');
    assert.equal(none.nextActions[0].operation, 'use_normal_tools');
    assert.ok(none.searched.conventional);
    const onlyGraphify = buildContext({ project: foreign, question: 'Why does `client` fail?' });
    assert.equal(onlyGraphify.status, 'unsupported_input');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('context matches explicit clues, keeps same-name records separate and respects scope and budgets', async () => {
  const { base, project } = await fixture();
  try {
    const found = buildContext({ project, question: 'Why does this API return pending?', clues: ['CheckoutService'] });
    assert.equal(found.status, 'context_found');
    assert.equal(found.question.text, 'Why does this API return pending?');
    const services = found.candidates.filter(c => c.title === 'CheckoutService');
    assert.deepEqual(services.map(c => c.location.path).sort(), ['src/checkout.ts', 'src/legacy/checkout.ts']);
    assert.equal(new Set(services.map(c => c.ref)).size, 2);
    assert.ok(services.every(c => c.matchBasis[0].includes('supplied clue "CheckoutService" equals the name')));
    assert.ok(found.limitations.some(l => /do not establish that a record explains/.test(l)));
    assert.deepEqual(found.nextActions[0].operation, 'read');

    const vague = buildContext({ project, question: 'Why is it slow?', sources: [found.sources.find(s => s.format === 'waxwing-source-snapshot').key] });
    assert.equal(vague.status, 'needs_clue');
    assert.ok(vague.vocabulary.includes('CheckoutService'));
    const miss = buildContext({ project, question: 'Why does `RefundProcessor` fail?' });
    assert.equal(miss.status, 'no_match');
    assert.ok(miss.limitations.some(l => /not proof/.test(l)));
    const words = buildContext({ project, question: 'How does the stock check work?', sources: ['docs/system/model.json'] });
    assert.equal(words.status, 'context_found');
    assert.ok(words.candidates.every(c => c.sourceKey === 'docs/system/model.json'));
    assert.throws(() => buildContext({ project, question: 'x', sources: ['nope'] }), /Unknown source "nope"/);

    for (const budget of [1024, 1500, 2048, 4096, 16384]) {
      const packet = buildContext({ project, question: 'Why does this API return pending?', clues: ['CheckoutService', 'checkout', 'status'], budget });
      assert.ok(bytes(packet) <= budget, `packet ${bytes(packet)} exceeds ${budget}`);
      assert.ok(['context_found', 'needs_scope', 'budget_too_small'].includes(packet.status), packet.status);
      if (packet.status !== 'budget_too_small' && packet.budget.truncated) assert.ok(Object.values(packet.budget.omitted).some(n => n > 0));
    }
    const tiny = buildContext({ project, question: 'q'.repeat(3000) + ' CheckoutService', budget: 1024 });
    assert.equal(tiny.status, 'budget_too_small');
    assert.ok(tiny.budget.minimumOutputBytes > 1024);
    assert.ok(bytes(tiny) <= 1024);
    assert.throws(() => buildContext({ project, question: 'q', budget: 10 }), /Budget must be/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('reads return verified excerpts, related references and existing view links; changes are explicit', async () => {
  const { base, project, knowledge } = await fixture();
  try {
    const found = buildContext({ project, question: 'Why pending?', clues: ['CheckoutService'] });
    const service = found.candidates.find(c => c.location?.path === 'src/checkout.ts');
    const read = readReference(service.ref, { project });
    assert.equal(read.status, 'record_found');
    assert.equal(read.record.excerpt.verification, 'source-byte-verified');
    assert.match(read.record.excerpt.mapping, /project root/);
    assert.ok(read.lines.some(line => line.includes("'pending'")));
    assert.equal(read.record.excerpt.startLine, 1);
    const incoming = read.related.find(r => r.relation === 'incoming-reference');
    assert.equal(incoming.location.path, 'src/main.ts');
    assert.equal(readReference(incoming.ref, { project }).status, 'record_found');

    // Continuation lines bind to the same reference and never exceed the budget.
    const partial = readReference(service.ref, { project, budget: 1024 + 900 });
    assert.ok(bytes(partial) <= 1924);
    if (partial.nextActions) assert.equal(readReference(service.ref, { project, fromLine: partial.nextActions[0].options.fromLine }).status, 'record_found');

    const component = buildContext({ project, question: 'What does Checkout do?', clues: ['checkout'], sources: ['docs/system/model.json'] }).candidates.find(c => c.kind === 'component' && c.id === 'checkout');
    const modelRead = readReference(component.ref, { project });
    assert.equal(modelRead.status, 'record_found');
    assert.ok(modelRead.views.some(v => v.path === 'docs/system/site/graphs/services.html' && v.fragment === 'record-checkout'));
    assert.ok(modelRead.views.every(v => fs.existsSync(path.join(project, v.path))));
    assert.ok(modelRead.related.some(r => r.kind === 'workflow'));
    const step = modelRead.related.find(r => r.kind === 'workflow');
    const workflow = readReference(step.ref, { project });
    const stepRead = readReference(workflow.related.find(r => r.kind === 'step').ref, { project });
    assert.equal(stepRead.status, 'record_found');
    assert.ok(stepRead.record.workflowRef);
    assert.ok(stepRead.views.some(v => v.path.startsWith('docs/system/site/workflows/')));

    // Changed bytes keep the record readable but withhold the excerpt.
    fs.appendFileSync(path.join(project, 'src/checkout.ts'), '// edited\n');
    const changed = readReference(service.ref, { project });
    assert.equal(changed.status, 'record_found');
    assert.equal(changed.record.excerpt.verification, 'changed');
    assert.deepEqual(changed.lines, []);
    assert.match(changed.record.excerpt.recovery, /Rescan/);
    // An explicit source-root mapping verifies against a matching tree.
    const copy = path.join(base, 'pinned tree');
    fs.cpSync(path.join(project, 'src'), path.join(copy, 'src'), { recursive: true });
    fs.writeFileSync(path.join(copy, 'src/checkout.ts'), fs.readFileSync(path.join(project, 'src/checkout.ts'), 'utf8').replace('// edited\n', ''));
    write(path.join(project, '.waxwing/config.json'), JSON.stringify({ schemaVersion: '0.1-project-config', artifacts: [path.join(knowledge, 'scan.json')], sourceRoots: { 'checkout-app': copy } }));
    const mapped = readReference(service.ref, { project });
    assert.equal(mapped.record.excerpt.verification, 'source-byte-verified');
    assert.match(mapped.record.excerpt.mapping, /sourceRoots\.checkout-app/);
    fs.rmSync(path.join(copy, 'src/legacy'), { recursive: true });
    const legacy = found.candidates.find(c => c.location?.path === 'src/legacy/checkout.ts');
    assert.equal(readReference(legacy.ref, { project }).record.excerpt.verification, 'unavailable');

    // A changed model makes references stale and offers the current one when the record remains.
    const modelFile = path.join(project, 'docs/system/model.json'), model = JSON.parse(fs.readFileSync(modelFile, 'utf8'));
    model.title += ' (revised)';
    fs.writeFileSync(modelFile, JSON.stringify(model, null, 2));
    const stale = readReference(component.ref, { project });
    assert.equal(stale.status, 'stale_reference');
    assert.equal(readReference(stale.currentRef, { project }).status, 'record_found');
    assert.throws(() => readReference('wx1.bad', { project }), /Unrecognized reference/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('CLI protocol commands emit compact JSON, structured errors, handoff files and opt-in measurement without question text', async () => {
  const { base, project } = await fixture();
  try {
    const log = path.join(base, 'measure.jsonl'), output = path.join(base, 'handoff', 'context.json');
    const secret = 'Why does SECRET-CUSTOMER-ACME see pending?';
    const result = run(path.join(project, 'src'), ['context', '--question', secret, '--clue', 'CheckoutService', '--format', 'json', '--output', output], { WAXWING_MEASUREMENT_LOG: log });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'context_found');
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).question.text, secret);
    const entries = fs.readFileSync(log, 'utf8');
    assert.match(entries, /"operation":"context"/);
    assert.ok(!entries.includes('SECRET') && !entries.includes('CheckoutService'));

    const direct = run(project, ['context', '--question', 'Why?', '--clue', 'CheckoutService']);
    assert.equal(direct.stdout.trim().split('\n').length, 1);
    const bad = run(project, ['context', '--question', 'Why?', '--budget', 'lots']);
    assert.equal(bad.status, 1);
    assert.equal(JSON.parse(bad.stderr).status, 'invalid_request');
    const unknown = run(project, ['read', 'wx1.bad']);
    assert.equal(JSON.parse(unknown.stderr).status, 'invalid_request');
    assert.equal(run(project, ['discover', '--format', 'yaml']).status, 1);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('explicit registration includes ignored knowledge and discovery is bounded', async () => {
  const base = temp();
  try {
    const project = path.join(base, 'repo');
    fs.mkdirSync(project);
    spawnSync('git', ['init', '-q'], { cwd: project });
    write(path.join(project, '.gitignore'), '.internal/\n');
    fs.cpSync(path.join(root, 'examples/order-processing/model.json'), path.join(project, '.internal/model.json'));
    assert.equal(discoverKnowledge({ project }).status, 'no_context');
    write(path.join(project, '.waxwing/config.json'), JSON.stringify({ schemaVersion: '0.1-project-config', artifacts: ['.internal/model.json'] }));
    assert.equal(discoverKnowledge({ project }).status, 'sources_found');
    write(path.join(project, '.waxwing/config.json'), '{"schemaVersion":"0.1-project-config","unexpected":true}');
    assert.equal(discoverKnowledge({ project }).diagnostics[0].code, 'discover/config');

    const plain = path.join(base, 'plain');
    for (let i = 0; i < 30; i++) write(path.join(plain, `dir${i}`, 'data.json'), '{"schemaVersion":"0.5-draft"}');
    const bounded = discoverKnowledge({ project: plain, limits: { maxCandidates: 10 } });
    assert.equal(bounded.searched.conventional.complete, false);
    assert.equal(bounded.searched.conventional.mode, 'filesystem');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
