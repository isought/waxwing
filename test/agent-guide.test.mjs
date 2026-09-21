import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateModel } from '../modules/model/index.mjs';
import { layoutModel, validateLayout } from '../modules/layout/index.mjs';
import { renderSVG, renderHTML } from '../modules/render/index.mjs';
import { recoverArtifact } from '../modules/render/artifacts.mjs';

// Exercise the actual copyable examples, not separate fixtures that can drift.
const guide = fs.readFileSync(new URL('../AGENT_GUIDE.md', import.meta.url), 'utf8');
const examples = new Map([...guide.matchAll(/<!-- waxwing-example: ([a-z]+) -->\s*```json\n([\s\S]*?)\n```/g)].map((match) => [match[1], JSON.parse(match[2])]));
for (const kind of ['architecture', 'scenario', 'behavior', 'relational']) test(`single-file agent guide: ${kind} example builds and recovers without external documents`, async () => {
  assert.ok(examples.has(kind), `Missing complete ${kind} example in AGENT_GUIDE.md`);
  const model = examples.get(kind), original = structuredClone(model);
  const result = validateModel(model);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const drawing = await layoutModel(model, kind === 'architecture' ? {groupingPerspectiveRef:'system-structure'} : {});
  assert.equal(validateLayout(drawing, {expectedModel: original}).ok, true);
  for (const artifact of [renderSVG(drawing), renderHTML(drawing)]) assert.deepEqual(recoverArtifact(artifact), original);
  if (kind === 'architecture') {
    for (const options of [{graphRef:'processing-detail'}, {workflowRef:'write-run'}]) assert.deepEqual(recoverArtifact(renderSVG(drawing, options)), original);
  }
  assert.deepEqual(model, original);
});

test('single-file agent guide: authoring, prepare, build, selected SVG and recovery work from an external output folder', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waxwing guide '));
  const cli = new URL('../bin/waxwing.mjs', import.meta.url).pathname;
  const canonical = examples.get('architecture'), authoring = structuredClone(canonical);
  const input = path.join(directory, 'authoring.json'), model = path.join(directory, 'model.json'), output = path.join(directory, 'diagram');
  const selected = path.join(directory, 'workflow.svg'), recovered = path.join(directory, 'recovered.json');
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], {cwd:directory, encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  };
  try {
    fs.mkdirSync(path.join(directory, 'docs'));
    authoring.documents = canonical.documents.map(({id,title,format,attachments,markdown}) => {
      fs.writeFileSync(path.join(directory, 'docs', `${id}.md`), markdown);
      return {id,title,format,attachments,file:`docs/${id}.md`};
    });
    fs.writeFileSync(input, JSON.stringify(authoring));
    run('prepare', input, model);
    assert.deepEqual(JSON.parse(fs.readFileSync(model, 'utf8')), canonical);
    run('validate', model);
    run('build', model, output, '--group', 'system-structure', '--direction', 'RIGHT');
    run('check-layout', path.join(output, 'layout.json'));
    fs.rmSync(path.join(directory, 'docs'), {recursive:true});
    fs.unlinkSync(input); fs.unlinkSync(model);
    run('render', path.join(output, 'layout.json'), selected, '--workflow', 'write-run');
    run('recover', selected, recovered);
    assert.deepEqual(JSON.parse(fs.readFileSync(recovered, 'utf8')), canonical);
    assert.deepEqual(recoverArtifact(fs.readFileSync(path.join(output, 'diagram.html'), 'utf8')), canonical);
  } finally { fs.rmSync(directory, {recursive:true, force:true}); }
});
