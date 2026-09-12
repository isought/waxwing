import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sourceNavigation } from '../../modules/knowledge/source/navigation.mjs';
import { renderSourceHTML } from '../../modules/presentation/source/index.mjs';

const [snapshotPath, sourceRoot, output] = process.argv.slice(2);
if (!snapshotPath || !sourceRoot || !output) throw new Error('Usage: node experiments/source-reading/run.mjs SNAPSHOT SOURCE-ROOT OUTPUT-DIRECTORY');
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const data = sourceNavigation(snapshot);
const texts = {};
for (const f of data.files.filter(f => f.status === 'analyzed')) {
  const name = path.resolve(sourceRoot, f.path), relative = path.relative(path.resolve(sourceRoot), name);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Source path escapes source root');
  const bytes = fs.readFileSync(name);
  if (createHash('sha256').update(bytes).digest('hex') !== f.contentDigest) throw new Error('Stale source: ' + f.path);
  texts[f.id] = bytes.toString('utf8');
}
const html = renderSourceHTML(snapshot, { sourceTexts: texts });
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'index.html'), html);
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ snapshotId: snapshot.id, files: Object.keys(texts).length, sourceRoot: path.resolve(sourceRoot), snapshotPath: path.resolve(snapshotPath), experiment: 'source-reading', changes: 'Presentation only; original scanner output retained.' }, null, 2));
console.log(JSON.stringify({ output: path.resolve(output), snapshotId: snapshot.id, files: Object.keys(texts).length }));
