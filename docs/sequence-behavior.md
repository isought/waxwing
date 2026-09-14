# Sequence behavior: loops and if/else

Use this contract to explain a scoped part of the **current implementation's
behavior**, including repetition and alternative paths. Use the original
[scenario contract](sequence.md) when recording one particular path. These are
different assertions: drawing both branches does not claim both occurred.

Try `npm run demo:sequence:markets` and open the
[fictional market collector](../examples/sequence-markets/README.md). It shows:

```text
Load configured markets
For each market, sequentially:
  If market.isOpen is true:
    Request live quote; receive live quote
  Else:
    Request closing quote; receive closing quote
  Save selected quote
Collection pass complete
```

The save is inside the loop, after either branch. Completion is outside the
loop. Which market comes first and the concrete iteration count remain unknown.

## JSON 1 and compatibility

[sequence-behavior.schema.json](../schemas/sequence-behavior.schema.json) defines
`schemaVersion: "0.2-sequence-draft"`, `diagramType: "sequence"`, and required
`describes: "behavior"`. Existing `0.1-sequence-draft` models retain their
original flat scenario contract. This is a separate version, not an automatic
reinterpretation or migration of an old model.

Both sequence versions support an optional [explicit workflow entry](sequence-entry.md),
with a qualified participant/starting-item pair and a separate trigger claim.
The entry item can be a root step, loop, or conditional. Known entry placement
comes from that declaration; an unknown/disputed entry is never guessed from the
first drawn branch. Existing root/body orders still define flow.

The behavior version retains `id`, `title`, `scope`, `sources`, `participants`,
`steps`, `notes`, and `documents`. It adds `blocks`, and makes `order` a qualified
list of the root body's direct step/block IDs. Every step uses `assertion`
instead of `occurrence`:

```json
{
  "id": "request-live",
  "label": "Request live quote for market",
  "kind": "message",
  "from": "collector",
  "to": "live",
  "assertion": {
    "status": "established",
    "value": true,
    "basis": {
      "sourceRefs": ["fixture"],
      "explanation": "The fixture defines this interaction in the true arm."
    }
  }
}
```

An asserted true definition belongs to its enclosing body when that body
executes. It does not assert an observed occurrence, execution on every request,
or completion despite an unmodeled failure. `message`, `reply`, and `event`
retain their [existing meanings](sequence.md#json-1-scenario-meaning).

`assertion` also qualifies each block's existence, kind, and stated placement.
Individual collection, predicate, execution-mode, iteration-order, and body-order
claims carry their own evidence. All use the existing established/reported/
inferred/unknown/disputed knowledge vocabulary.

## Loop blocks

| Field | Meaning |
|---|---|
| `id`, `label`, `kind: "loop"` | Stable identity and readable name for a collection loop. |
| `assertion` | Qualified boolean assertion of this behavior definition. |
| `collection` | Qualified text describing the collection being traversed. |
| `item` | Local name used for the current item, such as `market`. It is a label, not an evaluated variable. |
| `execution` | Qualified `sequential` or `concurrent`. Both are drawable when asserted. |
| `iterationOrder` | Qualified text describing visitation order, or an explicit unknown/dispute. |
| `body` | Qualified ordered list of direct step/block IDs; may be empty. |

The modeled body repeats once per item and zero times for an empty collection.
Concurrent loops display one iteration's ordered body with the cue “One iteration
shown; iterations may overlap.” For example, a basket of ten items can fan out
to ten calculations, each following the same body. The frame does not assert
simultaneous starts, a worker count, or a join policy.
No fixed count, nonempty guarantee, timing, or concurrency is inferred.
Sequential means iterations do not overlap at the modeled level; it does not
tell us which item comes first. An unknown visitation order therefore remains
drawable with an explicit label. An unknown execution mode does not.

This version represents collection traversal, not arbitrary `while`/`until`
conditions or retry limits. Do not translate either into a fictional collection
just to fit the schema. Record unsupported needs in notes/documents and scope.

## If/else blocks

| Field | Meaning |
|---|---|
| `id`, `label`, `kind: "if"` | Stable identity and readable name. |
| `assertion` | Qualified boolean assertion of this conditional definition. |
| `condition` | Qualified text describing one boolean predicate. |
| `then` | Qualified direct-child order when that predicate is true. |
| `else` | Qualified direct-child order when it is false; required, even if empty. |

On reaching the conditional, exactly one arm is selected by that predicate.
The diagram displays both definitions, separated and labeled as alternatives.
It does not evaluate expressions, choose a runtime value, or place the else
arm after the then arm in execution. After the selected body finishes, continue
with the next item in the enclosing body.

An empty arm uses an asserted order claim with `value: []`. It means no
interaction is specified there at the declared scope, not proof that the entire
system does nothing. Missing body knowledge uses `status: "unknown"`, not `[]`.

Loops and conditionals can nest in either direction. A nested conditional can
represent another binary decision; there is no separate switch/case primitive.

## Structure and replies

- Array storage order in `steps[]` and `blocks[]` has no semantic meaning.
  Root `order`, loop `body`, and conditional `then`/`else` define placement and
  ordering. Those arrays contain direct children, not all descendants.
- Each step/block has one parent body and one identity. Repeated definitions
  in separate arms need separate IDs; a shared continuation belongs after the
  conditional. IDs remain globally unique, including documents and evidence.
- Containment must be acyclic. Repetition comes from a loop's meaning, not a
  cycle of references. When all body memberships are known, every definition
  must be reachable from the root.
- A disputed body order may permute the same set of direct children. It cannot
  move work between branches or substitute a different membership set. Such
  membership uncertainty needs further modeling; do not encode it as ordering.
- A reply must reverse its target message's participants. The message must
  precede the reply on **every structural path reaching that reply**, within the
  same enclosing loop iteration. A request before an if may have separate replies
  in its arms. A request in one arm cannot support a reply in the other arm or
  after the conditional. A loop may run zero times, so its request cannot support
  a reply outside that loop.

These are conservative structural checks. Two separate tests of a similar
predicate are not correlated; the validator does not prove expression
equivalence, branch feasibility, or program correctness. Cross-iteration replies
and replies across different loop nesting contexts are unsupported.

If a body order is unknown, JSON 1 can still validate: that body supplies no
known membership list. Global reachability and complete path-sensitive reply
checks are then deferred. Known references, multiple parents, cycles, target
kinds, and reply endpoints are still checked. Layout remains blocked until all
body orders are asserted; successful source validation is not a claim that
these deferred checks succeeded.

## Knowledge uncertainty versus runtime alternatives

“The code tests `market.isOpen`” can be established even when nobody supplies its
runtime value. Both arms may be established definitions. Do not mark them
disputed merely because only one runs for a given market.

“We do not know which predicate the code tests” is an unknown `condition`.
Competing supported descriptions are a disputed `condition`. Both remain
drawable if the conditional's existence and true/false body placement are
established, reported, or inferred; the header says unknown/disputed and the
inspector preserves the details. If the body placement is also unclear, qualify
that uncertainty separately. Never imply a known branch mapping from an
unknown mapping.

| Source claim | JSON 1 | Layout |
|---|---|---|
| Asserted true step/block definitions and asserted body orders | Valid | Drawable with qualifications. |
| Unknown/disputed predicate, collection, or iteration order | Valid | Drawable with explicit uncertainty. |
| Unknown/disputed body order | Valid subject to the structure rules above | Blocked; no order is selected. |
| Unknown/disputed or asserted false step/block assertion | Valid subject to structure | Blocked; no definition is silently removed. |
| Asserted concurrent loop execution | Valid | One iteration shown with an explicit overlap cue; body order is preserved. |
| Unknown or disputed loop execution | Valid | Blocked; no execution mode is selected. |
| Invalid containment or incompatible reply path | Invalid when determinable | Blocked. |

## JSON 2 and rendering

[sequence-behavior-layout.schema.json](../schemas/sequence-behavior-layout.schema.json)
defines `0.2-sequence-layout-draft`. It embeds complete original JSON 1 with its
digest, participant and step geometry, and one geometry record per block:
`ref`, `box`, `header`, and `regions`. A region has `branch` (`body`, `then`, or
`else`), `box`, and `label` geometry. Wording and meaning resolve from the
embedded source rather than being independently authored in JSON 2.

Deterministic layout allocates space recursively. Validation checks exact record
coverage, source equality/digest, complete header space, nesting, correct arm
placement, body order, continuation placement, and absence of unrelated content
inside a frame. The SVG draws then above else as a reading convention, with
explicit branch labels. Steps are not globally numbered as if both arms ran.
Spacing does not encode duration; message arrows do not imply blocking.

The existing `@isought/waxwing/sequence` and general model/layout/render/artifact APIs and
CLI commands dispatch both versions. HTML and SVG preserve complete recoverable
source. HTML remains self-contained with evidence inspection, Markdown, zoom,
three skins, and theme switching. Select a block header for its evidence.

## Documents and references

Existing graph/participant/step document rules remain. This version adds an
explicit block target: `{ "kind": "block", "ref": "market-loop" }`.
Markdown can use `#block=market-loop`, or the full
`#graph=market-collection&block=market-loop`. Documents can attach to blocks;
notes can refer to their IDs. Unknown block IDs or wrong target types fail
validation. Older sequence and architecture contracts do not acquire block
targets. Cross-model navigation is still outside this contract.

## Current limits

There are no parallel frames, breaks, exceptions, early returns, runtime
unrolling, predicate evaluation, activation intervals, measured durations, or
cross-model subsequence expansion. Capture unsupported behavior honestly in
scope, notes, and documents. Do not draw a successful continuation if an
unmodeled failure makes that claim unsupported.
