# Cheap experiment: can agents reuse and challenge compact code notes?

Status: partially executed; three analyses completed and three attempts interrupted
or prevented by Claude's account usage limit. No application code changed.
Date: 2026-09-14.

See [initial results](RESULTS.md). Discovery worked; quality-preserving token
savings are not established, and the incorrect-note test remains unanswered.

Frozen inputs and review changes are in [evidence/](evidence/). Raw transcripts
are retained under `.internal/engineering/falsifiable-notes-20260914/` in this
worktree. The run uses Claude Code's documented `CLAUDE.md` import of AGENTS.md;
the note pointer appears only in AGENTS.md. The coordinating LLM substantially
reviewed the author output and added omitted balance/UI coverage, as recorded in
[review-changes.md](evidence/review-changes.md). Results therefore concern reviewed,
targeted notes, not unattended generation.

## Question and decision

Can compact application architecture notes, discovered only through AGENTS.md,
reduce an LLM's token consumption and unproductive investigation while preserving
answer quality? When a note is wrong, does the agent follow its challenge procedure,
identify contradictory code, and explicitly correct the note's claim?

These are separate hypotheses: efficiency and resistance to misleading notes.
Opening a file demonstrates discovery, not either benefit. The intended user is
an LLM coding agent. This experiment does not require Waxwing implementation.

The decision is whether to invest in producing and maintaining these notes. If
they are ignored, first investigate discovery. If used but not beneficial, do not
build an integration layer on the assumption that packaging will fix usefulness.
If incorrect notes mislead agents, revise the paradigm before product work.

## Existing fixture

- Repository: [Broadleaf Commerce](https://github.com/BroadleafCommerce/BroadleafCommerce/tree/5036306fcbd95180135a9ce0dc16b574f032936b).
- Revision: `5036306fcbd95180135a9ce0dc16b574f032936b`.
- Persistent local checkout: `/Users/david/learning/BroadleafCommerce` (clean,
  detached at the pinned revision; independent clone with the GitHub origin).
- Earlier local checkout: `/tmp/waxwing-field-impact-broadleaf-20260914`.
- Earlier baseline artifacts: `/Users/david/projects/waxwing/.internal/engineering/field-impact-baseline-20260914/`.
- Earlier task: assess removing `total = total.add(fees);` before
  `order.setTotal(total)` in `TotalActivity.execute`, with no other changes.

Two earlier source-search sessions produced useful but incomplete answers. Both
missed consequential conditions, including the distinction between zero and
negative remaining balances. Those observations motivate this fixture; they are
not a control group for a new run with different instructions or settings.

## Materials, with no product implementation

1. Use [paradigm.md](paradigm.md) as the note author's prompt. A separate author
   session investigates the pricing, balance, and checkout subsystem and writes
   `knowledge/checkout-notes.md` inside an isolated subject checkout.
2. Give the author source access but no evaluation task, earlier answers, scoring
   checklist, or expected findings. Record its model, prompt, tools and usage.
   The selected subsystem is still evaluator-selected, so this is a favorable
   test of relevant notes, not a test of automatic knowledge selection.
3. Audit claims against source. Preserve the raw output and record corrections
   and human preparation time. Freeze one reviewed note before subject runs.
4. In note conditions, add only the following discovery instruction to root
   `AGENTS.md`; do not embed notes in the task or system prompt:

   > Optional checkout architecture notes: `knowledge/checkout-notes.md`.
   > You may use them to orient your investigation. They are provisional claims:
   > check their evidence and challenge procedures before relying on relevant
   > conclusions. When source contradicts a claim, identify the mismatch and use
   > the source-supported conclusion.

Use an agent host with documented AGENTS.md support. Verify instruction loading
in a separate setup check. Do not assume that a prior CLI invocation loads this
file. Record auto-loaded content as well as explicit file reads. A setup failure
is not evidence against the note paradigm.

## Small first batch: six fresh sessions

| Condition | Sessions | Available knowledge |
| --- | --- | --- |
| A: source search | 2 | Existing repository only; no generated notes or note pointer |
| B: reviewed notes | 2 | Same source plus frozen notes and AGENTS.md pointer |
| C: one incorrect claim | 2 | Same as B, with one controlled error in a note |

For C, change the note's claim about payment-method visibility to say that zero
**or negative** remaining balance counts as covered, under the same third-party
payment qualification. Actual source uses `isZero()`. Keep a valid source anchor
and the same challenge procedure in B and C: inspect the precise balance predicate
and evaluate positive, zero, and negative cases. Change only the conclusion, not
its title, authority, formatting, or how prominently it is presented.

This is a deliberately seeded summary error. It tests whether an agent can reject
a plausible wrong claim despite an available check. It does not test natural drift
detection or establish the frequency of author errors. Keep evaluator records and
condition labels outside subject checkouts. Do not tell subjects that an error was
planted or ask them to audit notes as their primary task.

Use the same field-change question for all conditions, with the same request for
downstream consequences, conditions, source evidence and concrete examples.
Allow repository documentation equally in every condition. The earlier prompt's
ban on external knowledge artifacts must not accidentally prohibit the treatment.
Do not explicitly mention the notes in the task prompt.

Pin model, effort, tool access, output budget and instruction text. Use independent
sessions and identical source snapshots; randomize run order. Permit ordinary
search, listing and reading only. Do not let one subject's answer or edits reach
another. Record cache accounting and all transcripts. No runtime test claims are
allowed in these read-only sessions.

## What to observe

Before running, retain the earlier ten-check source rubric outside the checkout,
verify it against the pinned source, and freeze scoring. Review final answers
without condition labels where practical.

- **Discovery:** was AGENTS.md loaded, was the note opened, and is use evident in
  the investigation? Distinguish auto-injection from explicit retrieval.
- **Checking:** did the agent inspect the cited predicate and reason about a
  negative balance? Merely quoting a challenge recipe does not count.
- **Correction:** in C, did it explicitly identify the note's incorrect claim,
  cite the actual `isZero()` predicate, and explain that a negative balance does
  not satisfy it? Silently giving the correct answer is accuracy success but
  not demonstrated recognition of a bad note.
- **Quality:** source-supported rubric coverage, omitted conditions, unsupported
  impact claims, and new errors introduced by the notes.
- **Tokens:** report uncached input, cache writes, cache reads and output separately,
  plus the provider's cost estimate. Include instruction and note consumption.
  State any aggregate accounting convention; do not equate cached input with
  newly retrieved source volume.
- **Investigation:** tool calls, repeated reads/searches, files read, elapsed time,
  and manually reviewed dead-end excursions. Define an excursion as a sequence
  pursuing a hypothesis that supplies neither relevant evidence nor a useful
  exclusion. Record uncertain classifications; legitimate counterexample checks
  are useful work even when they find no contradiction.
- **Preparation:** author tokens, audit effort and corrections, independently of
  per-task costs. Report cumulative cost for N reuses as preparation + N times
  observed task cost, with assumptions explicit. Do not claim net savings from
  subject-run savings alone.

## Decision rules and limitations

This is a screening batch, not a statistically reliable benchmark. Predeclare a
practical efficiency target of at least 20% lower median accounted input-token
consumption for B versus A, without lower median rubric quality or a new serious
unsupported claim. Report output tokens, estimated cost and investigation results
alongside it; improvements in one metric must not conceal regressions in another.
Twenty percent is a chosen investment threshold, not an established effect size.

For this first screen, require both C sessions to explicitly detect and correct
the seeded error without carrying it into the impact conclusion. Any failure
blocks a claim of dependable correction. Passing two sessions only warrants a
larger test; it does not establish reliability.

If promising, repeat with another related task and add a plain-note condition
without challenge procedures to isolate their contribution. Then preserve notes
while applying a realistic source change that invalidates a claim. Include an
irrelevant source change as a control. These later tests address generalization,
actual staleness and whether verification itself creates needless rediscovery.

Record negative and mixed findings. Do not silently repair the notes mid-batch.
The final report must distinguish observed savings, correction behavior,
preparation cost, and unanswered questions before recommending implementation.
