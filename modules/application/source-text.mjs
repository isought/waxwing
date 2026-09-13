import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Reads one analyzed snapshot file only when its current bytes equal the recorded
// digest. Throws an Error whose message is a stable reason code otherwise.
export function readVerifiedSourceText(root, file) {
  const filename = path.join(root, file.path);
  let current = root;
  for (const part of file.path.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('symlink');
  }
  if (!fs.lstatSync(filename).isFile()) throw new Error('not-regular-file');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  let bytes;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('not-regular-file');
    if (stat.size !== file.byteLength) throw new Error('changed-bytes');
    bytes = fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
  if (createHash('sha256').update(bytes).digest('hex') !== file.contentDigest) throw new Error('changed-bytes');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.length !== file.textLength) throw new Error('changed-text-length');
  return text;
}
