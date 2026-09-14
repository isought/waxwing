import { isBehavior, ordersOf } from '../../knowledge/sequence/structure.mjs';

export function drawableDiagnostics(model) {
  const diagnostics = [];
  if (isBehavior(model)) {
    for (const { path, order } of ordersOf(model)) if (['unknown', 'disputed'].includes(order.status)) diagnostics.push({ code: 'sequence/unresolved-order', path, message: 'Each body needs one asserted order. A runtime branch is not a disputed order; no knowledge dispute is selected for drawing.' });
    for (const collection of ['steps', 'blocks']) model[collection].forEach((record, i) => {
      if (['unknown', 'disputed'].includes(record.assertion.status) || !record.assertion.value) diagnostics.push({ code: 'sequence/unresolved-behavior', path: `/${collection}/${i}/assertion`, message: 'This renderer needs an asserted definition within its enclosing body; it cannot invent missing or disputed behavior.' });
    });
    model.blocks.forEach((block, i) => {
      if (block.kind === 'loop' && (['unknown', 'disputed'].includes(block.execution.status) || !['sequential', 'concurrent'].includes(block.execution.value))) diagnostics.push({ code: 'sequence/unsupported-iteration', path: `/blocks/${i}/execution`, message: 'Loop execution must be asserted sequential or concurrent. Unknown or disputed execution cannot be selected for drawing.' });
    });
    return diagnostics;
  }
  if (['unknown', 'disputed'].includes(model.order.status)) diagnostics.push({ code: 'sequence/unresolved-order', path: '/order', message: 'A vertical sequence needs one asserted order. Unknown/disputed ordering remains valid JSON 1; this renderer cannot choose it.' });
  model.steps.forEach((step, i) => {
    if (['unknown', 'disputed'].includes(step.occurrence.status) || !step.occurrence.value) diagnostics.push({ code: 'sequence/unresolved-step', path: `/steps/${i}/occurrence`, message: 'This basic renderer needs an asserted occurrence for each ordered step. Preserve absent or unresolved occurrences in JSON 1; do not invent a drawable scenario.' });
  });
  return diagnostics;
}
