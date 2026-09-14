import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { loadModel } from '../modules/documents/index.mjs';
import { validateModel } from '../modules/model/index.mjs';
import { layoutModel, validateLayout } from '../modules/layout/index.mjs';
import { layoutSequence } from '../modules/sequence/index.mjs';
import { renderHTML, renderSVG } from '../modules/render/index.mjs';
import { recoverArtifact } from '../modules/render/artifacts.mjs';
import { digest } from '../modules/shared/model.mjs';
import { drawableDiagnostics } from '../modules/presentation/sequence/drawable.mjs';
import { blockLines } from '../modules/presentation/sequence/frames.mjs';

const dir = new URL('../examples/sequence-markets/', import.meta.url);
const model = loadModel(new URL('model.json', dir)).model;
const layout = layoutSequence(model);
const copy = () => structuredClone(model);
const known = (value) => ({ status: 'established', value, basis: { sourceRefs: ['fixture'], explanation: 'Fictional test definition.' } });
const loop = (m) => m.blocks.find((b) => b.kind === 'loop');
const condition = (m) => m.blocks.find((b) => b.kind === 'if');
const step = (m, id) => m.steps.find((s) => s.id === id);
function invalid(change, pattern) { const m = copy(); change(m); const r = validateModel(m); assert.equal(r.ok, false); assert.match(JSON.stringify(r.diagnostics), pattern); }

test('behavior uses separate established branch definitions with a loop and qualified iteration order', () => {
  const r = validateModel(model);
  assert.equal(r.ok, true); assert.equal(r.summary.blocks, 2); assert.equal(r.summary.unknown, 3);
  assert.equal(step(model, 'request-live').assertion.status, 'established');
  assert.equal(step(model, 'request-close').assertion.status, 'established');
  assert.ok(!Object.hasOwn(step(model, 'request-live'), 'occurrence'));
});

test('nested structure survives all pipeline stages and all skins without source mutation', async () => {
  const before = copy();
  assert.deepEqual(await layoutModel(model), layout);
  assert.equal(validateLayout(layout, { expectedModel: model }).ok, true);
  for (const skin of ['standard', 'engineering', 'editorial']) {
    const html = renderHTML(layout, { skin }), svg = renderSVG(layout, { skin });
    assert.deepEqual(recoverArtifact(html), model); assert.deepEqual(recoverArtifact(svg), model);
    assert.match(svg, /IF \/ ELSE/); assert.match(svg, /condition true/); assert.match(svg, /condition false/); assert.match(svg, /Execution: sequential/);
    assert.doesNotMatch(svg, /1\. message/); // No numbering that suggests both arms execute in order.
    // The accessible button covers the header, not a frame center that may hit an arrow.
    const loopButton = svg.match(/<g class="record" data-ref="market-loop"[^>]*>([\s\S]*?)<\/g>/)?.[1];
    assert.match(loopButton, /control-band/); assert.doesNotMatch(loopButton, /control-frame|control-divider/);
    for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  }
  assert.deepEqual(model, before);
});

test('storage order changes do not change geometry or body membership', () => {
  const m = copy(); m.steps.reverse(); m.blocks.reverse(); m.participants.reverse();
  const d = layoutSequence(m);
  for (const key of ['steps', 'blocks', 'participants', 'canvas']) assert.deepEqual(d[key], layout[key]);
});

test('the save is after the conditional inside the loop; completion is outside the loop', () => {
  const outer = layout.blocks.find((b) => b.ref === 'market-loop').box;
  const inner = layout.blocks.find((b) => b.ref === 'quote-route').box;
  const save = layout.steps.find((s) => s.ref === 'save-quote'), complete = layout.steps.find((s) => s.ref === 'complete');
  assert.ok(save.label.y > inner.y + inner.height);
  assert.ok(save.points.at(-1).y < outer.y + outer.height);
  assert.ok(complete.label.y > outer.y + outer.height);
});

test('an empty else body is explicit and drawable', () => {
  const m = copy(); condition(m).else = known([]); m.steps = m.steps.filter((s) => !['request-close', 'reply-close'].includes(s.id));
  assert.equal(validateModel(m).ok, true);
  const svg = renderSVG(layoutSequence(m));
  assert.match(svg, /ELSE · condition false/); assert.match(svg, /Empty body: no interaction specified here/);
});

test('a loop nested inside a conditional inside a loop retains all three frames', () => {
  const m = copy(), nested = structuredClone(loop(m));
  nested.id = 'venues'; nested.item = 'venue'; nested.collection = known('venues for market'); nested.body = condition(m).then;
  condition(m).then = known(['venues']); m.blocks.push(nested);
  const d = layoutSequence(m);
  assert.equal(validateLayout(d).ok, true); assert.equal(d.blocks.length, 3); assert.deepEqual(recoverArtifact(renderHTML(d)), m);
});

test('unknown/disputed conditions and unknown collection details can be shown without choosing values', () => {
  for (const predicate of [{ status: 'unknown', reason: 'Condition expression not identified.' }, { status: 'disputed', reason: 'Different source expressions.', alternatives: [known('market.isOpen'), known('market.liveEnabled')] }]) {
    const m = copy(); condition(m).condition = predicate; loop(m).collection = { status: 'unknown', reason: 'Collection source not identified.' };
    assert.equal(validateModel(m).ok, true);
    const html = renderHTML(layoutSequence(m));
    assert.match(html, new RegExp(`Condition: ${predicate.status}`)); assert.deepEqual(recoverArtifact(html), m);
  }
});

test('unresolved body order stays valid JSON 1 but rendering cannot silently pick an alternative', () => {
  for (const order of [{ status: 'unknown', reason: 'Body order not established.' }, { status: 'disputed', reason: 'Different independent ordering.', alternatives: [known(['load-markets','market-loop','complete']), known(['complete','market-loop','load-markets'])] }]) {
    const m = copy(); m.order = order; m.entry.point = { status: 'unknown', reason: 'This order fixture does not assert a single entry.' }; assert.equal(validateModel(m).ok, true);
    assert.throws(() => layoutSequence(m), (e) => e.diagnostics.some((d) => d.code === 'sequence/unresolved-order'));
  }
  const m = copy(); condition(m).then = { status: 'unknown', reason: 'Order unknown.' };
  assert.equal(validateModel(m).ok, true); assert.throws(() => layoutSequence(m), /unresolved/);
});

test('CLI builds concurrent fanout with one body per item and recoverable source', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'waxwing-fanout-'));
  try {
    const m = copy(); loop(m).execution = known('concurrent');
    loop(m).collection = known('basket of 10 items');
    fs.writeFileSync(path.join(folder, 'model.json'), JSON.stringify(m));
    fs.copyFileSync(new URL('reading.md', dir), path.join(folder, 'reading.md'));
    const cli = new URL('../bin/waxwing.mjs', import.meta.url).pathname;
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: folder, encoding: 'utf8' });
    assert.equal(run('validate', 'model.json').status, 0);
    const built = run('build', 'model.json', 'out');
    assert.equal(built.status, 0, built.stderr);
    const drawing = JSON.parse(fs.readFileSync(path.join(folder, 'out/layout.json'), 'utf8'));
    assert.equal(validateLayout(drawing, { expectedModel: m }).ok, true);
    assert.equal(drawing.steps.length, m.steps.length);
    for (const skin of ['standard', 'engineering', 'editorial']) {
      for (const artifact of [renderSVG(drawing, { skin }), renderHTML(drawing, { skin })]) {
        assert.match(artifact, /Execution: concurrent/);
        assert.match(artifact, /One iteration shown; iterations may overlap/);
        assert.deepEqual(recoverArtifact(artifact), m);
      }
    }
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('concurrent iteration accepts each asserted qualification and retains per-iteration ordering', () => {
  for (const status of ['established', 'reported', 'inferred']) {
    const m = copy(); loop(m).execution = { ...known('concurrent'), status };
    assert.deepEqual(drawableDiagnostics(m), []);
    assert.ok(blockLines(loop(m), 1000).includes(`Execution: concurrent [${status}]`));
    const d = layoutSequence(m);
    const request = d.steps.find((s) => s.ref === 'request-live');
    const reply = d.steps.find((s) => s.ref === 'reply-live');
    assert.ok(reply.label.y > request.points.at(-1).y);
    reply.label.y = request.label.y;
    assert.equal(validateLayout(d).ok, false);
  }
  assert.ok(!blockLines(loop(model), 1000).some((line) => line.includes('iterations may overlap')));
});

test('reported control structure remains qualified; unresolved loop execution is never relabeled sequential', () => {
  const qualified = copy(); loop(qualified).assertion.status = 'reported'; loop(qualified).body.status = 'inferred';
  assert.match(renderSVG(layoutSequence(qualified)), /Configured markets \[reported\]/);
  for (const execution of [{ status: 'unknown', reason: 'Execution not known.' }, { status: 'disputed', reason: 'Conflicting accounts.', alternatives: [known('sequential'), known('concurrent')] }]) {
    const m = copy(); loop(m).execution = execution; assert.equal(validateModel(m).ok, true);
    assert.throws(() => layoutSequence(m), (e) => e.diagnostics.some((d) => d.code === 'sequence/unsupported-iteration'));
  }
});

test('unresolved or absent behavior assertions remain source, not invented drawable interactions', () => {
  for (const claim of [known(false), { status: 'unknown', reason: 'Definition uncertain.' }]) {
    const m = copy(); condition(m).assertion = claim; assert.equal(validateModel(m).ok, true);
    assert.throws(() => layoutSequence(m), (e) => e.diagnostics.some((d) => d.code === 'sequence/unresolved-behavior'));
  }
});

test('cycles, multiple parents, orphans, undeclared children and changing branch membership are rejected', () => {
  invalid((m) => { loop(m).body.value.push('market-loop'); }, /acyclic|more than one body/);
  invalid((m) => { m.order.value.push('save-quote'); }, /more than one body/);
  invalid((m) => { loop(m).body.value.pop(); }, /not reachable/);
  invalid((m) => { condition(m).then.value.push('imagined'); }, /Unknown step or block/);
  invalid((m) => { condition(m).then = { status: 'disputed', reason: 'Membership differs.', alternatives: [known(['request-live','reply-live']), known(['save-quote'])] }; }, /same direct children/);
  invalid((m) => { m.blocks[1].id = 'collector'; }, /Duplicate ID/);
  invalid((m) => { delete condition(m).else; }, /"requiredProperty":"else"/);
});

test('reply validation rejects opposite-arm requests even when endpoints match', () => {
  invalid((m) => {
    step(m,'request-close').to = 'live'; step(m,'reply-close').from = 'live'; step(m,'reply-close').replyTo = 'request-live';
  }, /every path reaching it/);
});

test('replies cannot escape a conditional or loop that may not execute their request', () => {
  function addReply(m) { m.steps.push({ id: 'later-reply', label: 'Later reply', kind: 'reply', from: 'live', to: 'collector', replyTo: 'request-live', assertion: known(true) }); }
  invalid((m) => { addReply(m); loop(m).body.value.push('later-reply'); }, /every path reaching it/);
  invalid((m) => { addReply(m); m.order.value.push('later-reply'); }, /same enclosing loop iteration/);
  invalid((m) => { condition(m).then.value.reverse(); }, /preceding message/);
});

test('a message preceding the conditional can receive a reply in either arm', () => {
  const m = copy(); loop(m).body.value.unshift('request-live'); condition(m).then.value = ['reply-live']; condition(m).else.value = ['reply-close'];
  m.steps = m.steps.filter((s) => s.id !== 'request-close'); step(m,'reply-close').from = 'live'; step(m,'reply-close').replyTo = 'request-live';
  assert.equal(validateModel(m).ok, true); assert.equal(validateLayout(layoutSequence(m)).ok, true);
});

test('frame preservation rejects removed frames, swapped regions, misplaced steps and false containment', () => {
  for (const change of [
    (d) => { d.blocks.pop(); },
    (d) => { d.blocks[1] = structuredClone(d.blocks[0]); },
    (d) => { d.blocks.find((b) => b.ref === 'quote-route').regions.reverse(); },
    (d) => { d.blocks.find((b) => b.ref === 'quote-route').regions[0].box.height = 1; },
    (d) => { d.blocks[0].header.width = 1; },
    (d) => { d.blocks[0].regions[0].label.width = 1; },
    (d) => { const frame = d.blocks.find((b) => b.ref === 'market-loop'); frame.box.height = d.canvas.height - frame.box.y; },
    (d) => { const frame = d.blocks.find((b) => b.ref === 'quote-route'); frame.box.y = 1; },
    (d) => { const a = d.steps.find((s) => s.ref === 'request-live'), b = d.steps.find((s) => s.ref === 'request-close'); [a.label, b.label] = [b.label, a.label]; },
  ]) { const d = structuredClone(layout); change(d); assert.equal(validateLayout(d).ok, false); }
});

test('behavior source checks cover conditions, nested bodies and all inherited qualifications', () => {
  const d = structuredClone(layout); condition(d.model).condition.value = 'different condition';
  assert.equal(validateLayout(d).ok, false);
  d.modelDigest = digest(d.model); assert.equal(validateLayout(d, { expectedModel: model }).ok, false);
});

test('block documents and notes are checked, including explicit fragment rebinding', () => {
  assert.match(renderHTML(layout), /href="#graph=market-collection&amp;block=market-loop"/);
  invalid((m) => { m.documents[0].attachments[1].ref = 'missing'; }, /Unknown block target/);
  invalid((m) => { m.documents[0].links.find((l) => l.target.kind === 'block').target.ref = 'quote-route'; }, /changes the explicit target/);
  invalid((m) => { condition(m).condition.basis.sourceRefs = ['invented']; }, /expected sources/);
  const m = copy(); m.notes[0].subjectRefs = ['quote-route']; assert.equal(validateModel(m).ok, true);
});

test('version gates preserve old occurrence semantics and reject mixed schemas', () => {
  const old = loadModel(new URL('../examples/sequence/model.json', import.meta.url)).model;
  const before = structuredClone(old); const d = layoutSequence(old);
  assert.equal(d.schemaVersion, '0.1-sequence-layout-draft'); assert.deepEqual(recoverArtifact(renderHTML(d)), before);
  invalid((m) => { m.schemaVersion = '0.1-sequence-draft'; }, /schema/);
  invalid((m) => { m.steps[0].occurrence = known(true); }, /"keyword":"additionalProperties"/);
  invalid((m) => { m.describes = 'execution'; }, /"keyword":"const"/);
  const mixed = structuredClone(layout); mixed.schemaVersion = '0.1-sequence-layout-draft'; assert.equal(validateLayout(mixed).ok, false);
  const oldWithBlock = structuredClone(old); oldWithBlock.documents[0].attachments.push({ kind: 'block', ref: old.id }); assert.equal(validateModel(oldWithBlock).ok, false);
});

test('long and hostile-looking conditions are wrapped, escaped, and recoverable', () => {
  const m = copy(); condition(m).condition.value = '市场开放 '.repeat(60) + '</script><img src=x onerror=alert(1)>';
  const d = layoutSequence(m), html = renderHTML(d);
  assert.equal(validateLayout(d).ok, true); assert.doesNotMatch(html, /<img src=x/); assert.deepEqual(recoverArtifact(html), m);
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});

test('CLI builds and recovers behavior plus documents, and unresolved order leaves prior output intact', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'waxwing-behavior-'));
  const cli = new URL('../bin/waxwing.mjs', import.meta.url).pathname;
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: folder, encoding: 'utf8' });
  try {
    fs.copyFileSync(new URL('model.json', dir), path.join(folder,'model.json')); fs.copyFileSync(new URL('reading.md', dir), path.join(folder,'reading.md'));
    assert.equal(run('build','model.json','out').status, 0);
    const html = fs.readFileSync(path.join(folder,'out/diagram.html'),'utf8');
    const m = copy(); m.order = { status: 'unknown', reason: 'No established root order.' }; fs.writeFileSync(path.join(folder,'uncertain.json'), JSON.stringify(m));
    assert.equal(run('validate','uncertain.json').status, 0); assert.equal(run('build','uncertain.json','out').status, 1);
    assert.equal(fs.readFileSync(path.join(folder,'out/diagram.html'),'utf8'), html);
    fs.unlinkSync(path.join(folder,'model.json')); fs.unlinkSync(path.join(folder,'reading.md')); fs.unlinkSync(path.join(folder,'out/layout.json'));
    assert.equal(run('recover','out/diagram.html','recovered.json').status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'recovered.json'))), model);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
