import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanRepository } from '../../modules/application/scan.mjs';
import { createSelfExample, selfExampleRepository } from './fixture.mjs';

const contains = (root, target) => {
  const relative = path.relative(root, target);
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
function physical(filename) {
  const absolute = path.resolve(filename);
  if (fs.lstatSync(absolute, { throwIfNoEntry: false })) return fs.realpathSync(absolute);
  return path.join(physical(path.dirname(absolute)), path.basename(absolute));
}

export async function buildSelfDemo(outputDirectory) {
  if (typeof outputDirectory !== 'string' || !outputDirectory.trim()) throw new Error('Provide a demo output directory outside the repository.');
  const output = physical(outputDirectory), root = fs.realpathSync(selfExampleRepository);
  if (contains(root, output)) throw new Error('Demo output must be outside the repository so generated inputs do not enter later scans.');
  const inputs = path.join(output, 'inputs');
  // A new directory prevents repeated runs from silently replacing the exact
  // snapshot inputs belonging to an already published or inspected demo.
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(inputs);
  const started = performance.now();
  const snapshot = await scanRepository(root);
  const { model, links } = createSelfExample(snapshot);
  const filenames = { model: path.join(inputs, 'model.json'), snapshot: path.join(inputs, 'snapshot.json'), links: path.join(inputs, 'source-links.json') };
  for (const [name, value] of Object.entries({ model, snapshot, links })) fs.writeFileSync(filenames[name], JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const { buildConnectedSiteFiles } = await import('../../modules/application/connected.mjs');
  const result = await buildConnectedSiteFiles(filenames.model, filenames.snapshot, filenames.links, path.join(output, 'site'), { sourceRoot: root, direction: 'RIGHT' });
  const entryRef = links.links.find(link => link.id === 'pipeline-entry').entryRef;
  const source = path.join(output, 'site', 'source', 'index.html');
  return { ...result, outputDirectory: output, overview: path.join(output, 'site', 'index.html'), source, focusedSource: `${source}#${entryRef}`, entryRef, snapshotId: snapshot.id, elapsedMs: Math.round(performance.now() - started) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node experiments/connected-source/demo.mjs OUTPUT-DIRECTORY');
    const result = await buildSelfDemo(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    if (error.diagnostics) console.error(JSON.stringify(error.diagnostics, null, 2));
    process.exitCode = 1;
  }
}
