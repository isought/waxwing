import { wrap, units } from '../shared/model.mjs';
import { regionsOf } from '../../knowledge/sequence/structure.mjs';
import { entryCue } from './entry.mjs';

function qualified(claim) {
  return ['unknown', 'disputed'].includes(claim.status) ? claim.status : `${claim.value} [${claim.status}]`;
}
export function blockLines(block, width, model = {}) {
  const text = block.kind === 'loop' ? [
    `LOOP · ${block.label} [${block.assertion.status}]`,
    `For each ${block.item} in ${qualified(block.collection)}`,
    `Execution: ${qualified(block.execution)}`,
    ...(block.execution.value === 'concurrent' ? ['One iteration shown; iterations may overlap.'] : []),
    `Iteration order: ${qualified(block.iterationOrder)}`,
  ] : [`IF / ELSE · ${block.label} [${block.assertion.status}]`, `Condition: ${qualified(block.condition)}`];
  return [...entryCue(model, block.id), ...text].flatMap((line) => wrap(line, Math.max(8, Math.floor((width - 24) / 7.2))));
}
export function regionLines(block, branch) {
  const order = block[branch];
  return [`${branch === 'body' ? 'BODY' : branch === 'then' ? 'THEN · condition true' : 'ELSE · condition false'} · order: ${order.status}`,
    ...(!order.value.length ? ['Empty body: no interaction specified here.'] : [])];
}
export const bandHeight = (lines) => lines.length * 18 + 16;

// Validate source containment, not just visual rectangle nesting. In particular,
// placing an else interaction in the then region cannot pass as preserved meaning.
export function frameDiagnostics(drawing) {
  const model = drawing.model, diagnostics = [];
  const add = (path, message) => diagnostics.push({ code: 'sequence/frame', path, message });
  const frames = new Map(drawing.blocks.map((b) => [b.ref, b])), sources = new Map(model.blocks.map((b) => [b.id, b]));
  const step = new Map(drawing.steps.map((s) => [s.ref, s]));
  const contains = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width + .01 && b.y + b.height <= a.y + a.height + .01;
  const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const bandFits = (box, lines) => box.height >= bandHeight(lines) && box.width + .01 >= Math.max(...lines.map(units)) * 7.2 + 24;
  const canvas = { x: 0, y: 0, ...drawing.canvas };
  const bounds = (id) => {
    if (frames.has(id)) return frames.get(id).box;
    const s = step.get(id), xs = [s.label.x, s.label.x + s.label.width, ...s.points.map((p) => p.x)];
    const ys = [s.label.y, s.label.y + s.label.height, ...s.points.map((p) => p.y)];
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  };
  function descendants(order) {
    const ids = new Set();
    for (const id of order.value) { ids.add(id); if (sources.has(id)) for (const branch of regionsOf(sources.get(id))) for (const child of descendants(sources.get(id)[branch])) ids.add(child); }
    return ids;
  }
  function sequence(order, area, startY, path) {
    let previous = startY;
    for (const id of order.value) {
      const box = bounds(id);
      if (!contains(area, box) || box.y <= previous) add(path, `"${id}" must be inside its own body, after the preceding item.`);
      previous = box.y + box.height;
    }
    return previous;
  }
  const headerBottom = Math.max(...drawing.participants.map((p) => p.box.y + p.box.height));
  sequence(model.order, canvas, headerBottom, '/order');
  for (const [i, frame] of drawing.blocks.entries()) {
    const source = sources.get(frame.ref), path = `/blocks/${i}`;
    const expected = regionsOf(source);
    if (!contains(canvas, frame.box) || frame.box.y <= headerBottom || !contains(frame.box, frame.header) || !bandFits(frame.header, blockLines(source, frame.header.width, model))) add(path, 'Frame and complete header must fit below participants and inside the canvas.');
    if (frame.regions.length !== expected.length || frame.regions.some((r, j) => r.branch !== expected[j])) { add(path, 'Frame regions must exactly match the source body or then/else arms, in drawing order.'); continue; }
    let previous = frame.header.y + frame.header.height;
    const owned = new Set();
    for (const region of frame.regions) {
      const location = `${path}/regions/${region.branch}`;
      if (!contains(frame.box, region.box) || !contains(region.box, region.label) || region.box.y <= previous || !bandFits(region.label, regionLines(source, region.branch))) add(location, 'Body labels and regions must fit without overlapping the preceding header or arm.');
      sequence(source[region.branch], region.box, region.label.y + region.label.height, location);
      const allowed = descendants(source[region.branch]);
      for (const id of allowed) owned.add(id);
      // Ancestor frames contain a region by design; all steps and non-ancestor
      // blocks intersecting it must belong to the source body.
      for (const s of drawing.steps) if (!allowed.has(s.ref) && overlap(region.box, bounds(s.ref))) add(location, `Unrelated step "${s.ref}" appears inside this body.`);
      previous = region.box.y + region.box.height;
    }
    for (const s of drawing.steps) if (!owned.has(s.ref) && overlap(frame.box, bounds(s.ref))) add(path, `Frame encloses unrelated step "${s.ref}".`);
    for (const other of drawing.blocks) {
      if (other.ref === frame.ref || owned.has(other.ref)) continue;
      const ancestor = regionsOf(sources.get(other.ref)).some((key) => descendants(sources.get(other.ref)[key]).has(frame.ref));
      if (!ancestor && overlap(frame.box, other.box)) add(path, 'Unrelated control frames overlap.');
    }
  }
  return diagnostics;
}
