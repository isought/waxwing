import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const modules = path.join(root, 'modules');
const dependencies = {
  knowledge: ['knowledge'],
  analysis: ['analysis', 'knowledge'],
  presentation: ['presentation', 'knowledge'],
  application: ['application', 'analysis', 'knowledge', 'presentation'],
  interfaces: ['interfaces', 'application', 'analysis', 'knowledge', 'presentation'],
};
function files(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory() ? files(name) : /\.[cm]?js$/.test(name) ? [name] : [];
  });
}

test('implementation imports follow responsibility boundaries and never go through compatibility entry points', () => {
  const violations = [];
  for (const [owner, allowed] of Object.entries(dependencies)) for (const file of files(path.join(modules, owner))) {
    const source = fs.readFileSync(file, 'utf8');
    // The repository uses literal ESM imports/re-exports and literal dynamic imports.
    const imports = [
      ...source.matchAll(/^\s*(?:import|export)\s+(?:[\w$*{},\s]+?\s+from\s*)?['"]([^'"]+)['"]/gm),
      ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map(match => match[1]);
    for (const specifier of imports) {
      if (specifier.startsWith('node:')) continue;
      if (!specifier.startsWith('.')) {
        if (!['ajv', 'markdown-it', ...(owner === 'presentation' ? ['elkjs'] : []), ...(owner === 'analysis' ? ['typescript'] : [])].some(name => specifier === name || specifier.startsWith(name + '/'))) {
          violations.push(`${path.relative(root, file)} imports unassigned dependency ${specifier}`);
        }
        continue;
      }
      const target = path.resolve(path.dirname(file), specifier);
      const targetOwner = path.relative(modules, target).split(path.sep)[0];
      const skillAdapter = owner === 'interfaces' && target.startsWith(path.join(root, 'skills') + path.sep);
      if (!allowed.includes(targetOwner) && !skillAdapter) violations.push(`${path.relative(root, file)} → ${path.relative(root, target)}`);
      assert.ok(fs.existsSync(target), `Missing import: ${file} → ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('knowledge validation, queries and review planning run with every other responsibility absent', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'waxwing-knowledge-'));
  try {
    fs.cpSync(path.join(modules, 'knowledge'), path.join(temporary, 'modules/knowledge'), { recursive: true });
    fs.cpSync(path.join(root, 'schemas'), path.join(temporary, 'schemas'), { recursive: true });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
    const entry = name => pathToFileURL(path.join(temporary, 'modules/knowledge', name)).href;
    const model = JSON.parse(fs.readFileSync(path.join(root, 'examples/order-processing/model.json'), 'utf8'));
    const script = `
      import assert from 'node:assert/strict';
      for (const entry of ${JSON.stringify(files(path.join(temporary, 'modules/knowledge')).map(file => pathToFileURL(file).href))}) await import(entry);
      const { validateModel } = await import(${JSON.stringify(entry('architecture/model.mjs'))});
      const { queryModel } = await import(${JSON.stringify(entry('query/index.mjs'))});
      const { compareModelRecords } = await import(${JSON.stringify(entry('records/compare.mjs'))});
      const { validateWorkspace } = await import(${JSON.stringify(entry('workspace/model.mjs'))});
      const { affectedModels } = await import(${JSON.stringify(entry('workspace/review.mjs'))});
      const model = ${JSON.stringify(model)};
      assert.equal(validateModel(model).ok, true);
      assert.ok(queryModel(model, 'inspect', model.entities[0].id).results.length);
      const after = structuredClone(model); after.entities[0].label = 'Changed label';
      assert.deepEqual(compareModelRecords(model, after).changed.map(r => r.id), [model.entities[0].id]);
      const manifest = {schemaVersion:'0.1-workspace-draft',id:'isolated',title:'Isolated',sources:[],models:[{id:'system',modelId:model.id,location:'model.json',sourceRefs:[]}]};
      assert.deepEqual(validateWorkspace(manifest, '/no-workspace-files'), []);
      const report = {ok:true,workspace:{id:'isolated'},sources:[{id:'code',status:'available'}],models:[{id:'system',sourceRefs:['code'],status:'available'}],relationships:[],diagnostics:[]};
      assert.deepEqual(affectedModels(report,{sources:['code']}).reviews.map(r => r.id), ['system']);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
