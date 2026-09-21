# Initial results: notes were opened, benefit not established

Date: 2026-09-14. Status: **incomplete because of Claude account usage limits**.
Three of six planned analyses completed. No application code was edited or tests
executed. Do not treat this as a completed six-session experiment.

## Finding

The AGENTS.md discovery mechanism worked. Both sessions that reached the note
conditions opened the note as their second tool call. They also inspected its
UI source anchor. This establishes retrieval and source inspection, not faithful
use of the note's qualifications.

The one completed reviewed-note session omitted conditions explicitly supplied
in the note, including the remaining-balance predicate and negative-balance case.
It also omitted fee-tax retention and taxOverride, and asserted a universal
group/order-total relationship that the note explicitly declined to establish.
Like both controls, it called the intended exclusion undercharging without an
independently established business requirement.

That session consumed less accounted input than the median of two controls, but
almost the same input as the cheaper control, used more tool calls than the
control median, and had poorer rubric coverage. **This is not evidence of a
quality-preserving efficiency improvement.** One treatment run cannot establish
a treatment effect.

The incorrect-note session was interrupted before producing its analysis.
It had read the note and the contradictory `isZero()` implementation, but its
visible responses did not explicitly identify the note error. **The falsification
question is unanswered**, not failed: no completed incorrect-note answer exists.

## Completed observations

| Condition | Run | Accounted input | Output tokens | Tool calls | Files read | Seconds | Estimated USD | Rubric /10 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Source only | session-01 | 1,727,941 | 16,964 | 45 | 18 | 274.4 | 1.8728 | 6.5 |
| Source only | session-02 | 917,500 | 12,304 | 32 | 14 | 229.0 | 1.2450 | 6.5 |
| Reviewed notes | session-03 | 928,684 | 14,464 | 44 | 15 | 255.2 | 1.1295 | 5.0 |

Accounted input = reported uncached input + cache creation + cache reads,
accumulated across requests. It is not unique source content. Output includes
the CLI's reported model output, not just final-answer words. Detailed categories
and auxiliary model accounting are in [summary.json](evidence/summary.json).

The single completed note run had 29.8% less input and a 27.5% lower estimated
cost than the control median, but 14.3% more calls and 1.4% more elapsed time.
Its input was 1.2% higher than the cheaper control. These are descriptive
comparisons, not the predeclared two-versus-two comparison or statistical results.
The no-quality-regression requirement is not satisfied by this observation.

Manual scores use the frozen ten-check rubric. The review was performed by the
coordinating LLM with condition labels visible; it is not blind or independent.
The scores are finite coverage checks, not proof of impact completeness. Source
evidence, per-check scores and grading qualifications are retained in
[grading.json](evidence/grading.json). An initial draft gave session-02 full
credit for the payment guard; final review reduced that to partial because its
payment-selection conditions were missing, consistently with the other runs.
The rubric itself was unchanged.

### Did the notes prevent unproductive investigation?

No reduction is established. The note run read the note, then used Glob to locate
several already-anchored files and performed broad getTotal searches. Its 44 calls
compare with 45 and 32 in the controls. That is observable extra navigation,
not proof that the searches were useless.

The call sequences were reviewed. Reconciliation searches and checks of other
test fixtures could yield legitimate exclusions and were not counted as rabbit
holes merely because they did not lead to another impact claim. No defensible
quantitative dead-end reduction emerged from this small partial batch. Repeated
calls and file reads are recorded separately in the raw summaries and must not
be presented as equivalent to wasted reasoning.

## Interrupted observations

| Condition | Run | Status |
| --- | --- | --- |
| Incorrect note | session-04 | 41 calls; read note and UI source; stopped by usage limit before final analysis |
| Incorrect note | session-05 | Refused at startup; zero model tokens and zero calls |
| Reviewed notes | session-06 | Refused at startup; zero model tokens and zero calls |

The CLI reported a reset at **8:40 p.m. America/New_York on September 14**.
These three runs are excluded from quality and comparative efficiency results.
The interrupted run used 789,273 accounted input tokens and 7,199 output tokens,
with an estimated cost of $0.9650. Its incomplete resource use is not a cheap
successful outcome.

## Note generation and setup

- Model: `claude-sonnet-4-6`, high effort; Claude Code 2.1.47. Same model, prompt,
  text tools and settings across subjects. The CLI also reported a small amount
  of auxiliary Haiku usage; full accounting is retained.
- Source revision: `5036306fcbd95180135a9ce0dc16b574f032936b`.
- Six independent clones under `/Users/david/learning/broadleaf-notes-experiment/`;
  the persistent original checkout remains clean.
- Only Grep, Glob and Read available; no skills invocation, MCP, browser, edits,
  tests, or experimental-subject delegation. Auto memory and hooks disabled.
- Claude uses an identical `CLAUDE.md` containing `@AGENTS.md` in every subject
  checkout. Only the note conditions add the optional note pointer to AGENTS.md.
  The note is not embedded in the task or system prompt.
- A separate setup session returned an exact marker stored only in AGENTS.md,
  with zero tools. This verifies the documented import mechanism in this host.
  See [Claude's instruction-file documentation](https://code.claude.com/docs/en/memory#agents-md).
- The author received only the paradigm prompt in a clean checkout, without the
  field-change question or rubric. It used 33 calls, 607,502 accounted input
  tokens, 7,647 output tokens, 124.1 seconds, and an estimated $0.8135.
- The raw author output omitted balance/UI coverage and contained overbroad
  assertions. The coordinator substantially reviewed it and added those claims.
  This is a favorable, evaluator-curated note test, not unattended authoring.
  [Raw notes](evidence/author-raw-notes.md), [reviewed notes](evidence/reviewed-notes.md),
  and [all review changes](evidence/review-changes.md) are retained.
- The 782-word reviewed note and the incorrect note differ by exactly one claim
  sentence about zero versus negative balance. Evidence and challenge instructions
  are identical. This is a seeded summary error, not actual source drift.
- Input/output records are retained for the author and setup. Coordinator review
  token billing is unavailable; no human review time was incurred. The full cost
  of preparation is therefore not known, and net reuse savings cannot be claimed.
- Total CLI-estimated usage cost across setup, author, completed and interrupted
  sessions: **$6.0439**. This is an estimate, not a claim of an extra cash charge.

## Validity and remaining work

The fixed randomization seed happened to place both controls first. Runs shared
host/provider caches and at most two ran concurrently. Cache and order effects,
small sample size, evaluator-curated content, and unblinded scoring limit the
comparison. The parser found no outside-checkout tool paths, tool errors or
permission denials. All tracked Java repository files remained unchanged.

The batch has ended; no experiment process or scheduled retry is running.
To finish the original screen, run fresh replacements for session-04, session-05
and session-06 after account access is restored, preserving the frozen source,
notes, prompt and settings. Keep the failed attempts in the record. Do not resume
their conversations or substitute a different model into the comparison. Record
the restart's cache/time differences as another limitation.

Do not expand to another repository or build product features from these partial
results. First finish the falsification test and the second reviewed-note run.
If later testing follows, separate plain compact notes from notes with challenge
procedures; this batch does not isolate the challenge procedure's contribution.

## Artifacts

- [Frozen protocol and order](evidence/preregistration.json)
- [Exact subject prompt](evidence/subject-prompt.txt)
- [Frozen rubric](evidence/rubric.md)
- [Source-only answer 1](evidence/session-01-answer.md)
- [Source-only answer 2](evidence/session-02-answer.md)
- [Reviewed-note answer](evidence/session-03-answer.md)
- [Usage summaries](evidence/summary.json)
- [Scoring](evidence/grading.json)

Full invocations, transcripts, tool calls and stderr logs are retained at
`.internal/engineering/falsifiable-notes-20260914/` in this worktree. The local
runner is [run-session.py](run-session.py); extraction is [summarize.py](summarize.py).
