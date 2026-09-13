import { digest } from '../shared/model.mjs';

export const CONTEXT_PROTOCOL = '0.1-context';
export const CONTEXT_STATUSES = ['context_found', 'needs_scope', 'needs_clue', 'no_context', 'no_match', 'unsupported_input', 'budget_too_small', 'record_found', 'stale_reference', 'invalid_request', 'runtime_error'];
export const DEFAULT_BUDGET = 16384;
export const MIN_BUDGET = 1024;
export const MAX_BUDGET = 1048576;

// References are opaque to agents but bound to an artifact identity and revision.
// Their characters are shell-neutral; callers still pass them as one argument.
export function encodeReference({ sourceKey, revision, recordId, kind }) {
  for (const [name, value] of Object.entries({ sourceKey, revision, recordId, kind })) {
    if (typeof value !== 'string' || !value) throw new Error(`Reference ${name} must be a nonempty string.`);
  }
  const body = Buffer.from(JSON.stringify([sourceKey, revision, recordId, kind]), 'utf8').toString('base64url');
  return `wx1.${body}.${digest([sourceKey, revision, recordId, kind]).slice(0, 12)}`;
}

export function decodeReference(reference) {
  const match = typeof reference === 'string' && reference.match(/^wx1\.([A-Za-z0-9_-]+)\.([a-f0-9]{12})$/);
  if (!match) throw new Error('Unrecognized reference. Use a reference returned by waxwing context or discover.');
  let parts;
  try { parts = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); } catch { parts = null; }
  if (!Array.isArray(parts) || parts.length !== 4 || parts.some(value => typeof value !== 'string' || !value) || digest(parts).slice(0, 12) !== match[2]) {
    throw new Error('Corrupted reference. Use a reference returned by waxwing context or discover.');
  }
  const [sourceKey, revision, recordId, kind] = parts;
  return { sourceKey, revision, recordId, kind };
}

export function validBudget(value) {
  const budget = value ?? DEFAULT_BUDGET;
  if (!Number.isInteger(budget) || budget < MIN_BUDGET || budget > MAX_BUDGET) throw new Error(`Budget must be an integer number of bytes from ${MIN_BUDGET} to ${MAX_BUDGET}.`);
  return budget;
}

export const packetBytes = packet => Buffer.byteLength(JSON.stringify(packet) + '\n', 'utf8');

// Fits whole items into the complete UTF-8 response, including metadata. Items are
// never shortened; a response whose required envelope cannot fit is rejected.
export function fitPacket(envelope, lists, budget) {
  const packet = structuredClone(envelope);
  packet.budget = { maxOutputBytes: budget, truncated: false, omitted: {} };
  for (const key of Object.keys(lists)) packet[key] = [];
  // Reserve the bytes of a worst-case truncation marker so incremental sizes stay exact enough.
  let used = packetBytes(packet) + Buffer.byteLength(JSON.stringify({ truncated: true, omitted: Object.fromEntries(Object.keys(lists).map(key => [key, 1e9])) })) - Buffer.byteLength(JSON.stringify({ truncated: false, omitted: {} }));
  if (packetBytes(packet) > budget) return null;
  for (const [key, items] of Object.entries(lists)) {
    for (const [index, item] of items.entries()) {
      const size = Buffer.byteLength(JSON.stringify(item), 'utf8') + (packet[key].length ? 1 : 0);
      if (used + size > budget) {
        packet.budget.truncated = true;
        packet.budget.omitted[key] = items.length - index;
        break;
      }
      packet[key].push(item);
      used += size;
    }
  }
  if (!packet.budget.truncated) delete packet.budget.omitted;
  return ordered(packet, Object.keys(lists), budget);
}

// Presentation order only: envelope, lists, next actions, budget, measurement.
function ordered(packet, listKeys, budget) {
  const { nextActions, budget: fitted, measurement, ...rest } = packet;
  const head = Object.fromEntries(Object.entries(rest).filter(([key]) => !listKeys.includes(key)));
  const result = { ...head, ...Object.fromEntries(listKeys.map(key => [key, rest[key]])), ...(nextActions ? { nextActions } : {}), budget: fitted, ...(measurement ? { measurement } : {}) };
  return trim(result, listKeys, budget);
}

function trim(packet, listKeys, budget) {
  // The truncation flag itself adds bytes; remove trailing items until it fits.
  while (packetBytes(packet) > budget) {
    const key = [...listKeys].reverse().find(name => packet[name].length);
    if (!key) return null;
    packet[key].pop();
    packet.budget.truncated = true;
    packet.budget.omitted ??= {};
    packet.budget.omitted[key] = (packet.budget.omitted[key] ?? 0) + 1;
  }
  return packet;
}

export function budgetTooSmall(protocol, budget, minimumBytes) {
  return { protocolVersion: CONTEXT_PROTOCOL, status: 'budget_too_small', ...protocol,
    budget: { maxOutputBytes: budget, minimumOutputBytes: minimumBytes, truncated: true },
    nextActions: [{ operation: 'retry', arguments: [], options: { budget: Math.min(MAX_BUDGET, Math.max(minimumBytes, budget * 2)) } }] };
}
