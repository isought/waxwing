# Baseline difficulty screen: nested exception after quote calculation

Date: 2026-09-14. Status: completed; **the target failure was not observed**.

Three fresh Claude Sonnet 4.6 sessions, high effort, each predicted all four
terminal responses correctly using only Glob, Grep and Read. No workflow hints
were supplied, and no hint experiment was run.

## Fixture

The executable fixture contains 29 Java classes / 327 Java lines plus three
configuration files. This is a small layered difficulty screen, **not the proposed
10,000-line scale test**. No filler or misleading identifiers were added.

The endpoint calls a service, which executes stages selected by configuration.
Amounts, discounts, delivery and tax produce a Draft with total `x = 12960`.
A later Recording stage invokes QuoteStore/PreparedQuotes, then Allocations,
AccountDirectory and PostingRegistry. Region and account terms select an interface
implementation. DeferredPosting reaches ExposureBook and Bucket; Bucket.append
throws CapacityExceeded when existing bookings plus the new amount exceed the
ceiling. PreparedQuotes wraps that in StoreConflict. The endpoint catches it, and
ResponseMapper replaces the successful response with an error.

No validation method is explicitly invoked by the caller. The relevant condition
is nested within recording and account allocation, across classes and configured
interface selection. The source remains ordinary, searchable Java.

## Executed ground truth

All requests independently use quantity 10, unit price 1200, currency EUR, and a
fresh endpoint/state. All calculate 12960 before recording.

| Account | Distinguishing condition | Terminal response |
| --- | --- | --- |
| A17 | EU/NET30, 38000 + 12960 > 50000 | 409, `{"code":"ACCOUNT_CAPACITY","account":"A17"}` |
| B29 | EU/NET30, 36000 + 12960 < 50000 | 201, `{"account":"B29","currency":"EUR","x":12960}` |
| C31 | EU/NET30, 37040 + 12960 = 50000 | 201, `{"account":"C31","currency":"EUR","x":12960}` |
| D44 | US/NET30 selects prepaid; exposure limit not consulted | 201, `{"account":"D44","currency":"EUR","x":12960}` |

The evaluator compiled and executed the program using [Probe.java](evidence/Probe.java).
The probe and expected outputs were outside subject checkouts. Subjects were
prohibited from executing code; their answers were compared with actual execution.

## Observations

| Session | Correct terminal responses | Calls | Unique files read | Accounted input | Output tokens | Seconds | Estimated USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 01 | 4/4 | 34 | 32 | 108901 | 5762 | 80.7 | 0.2868 |
| 02 | 4/4 | 31 | 29 | 106201 | 5819 | 86.9 | 0.2910 |
| 03 | 4/4 | 33 | 30 | 105616 | 5419 | 64.9 | 0.2753 |

All three traced exception wrapping/mapping, the strict greater-than boundary,
and configuration selecting prepaid versus deferred behavior. None returned the
computed x for A17. Session 03 has a minor explanatory slip: its final D44
parenthesis calls 49000 the ceiling; that is the booked amount, while the ceiling
is 50000. It correctly establishes that neither is consulted for prepaid posting,
so the terminal prediction and decisive reasoning remain correct. No claim of
perfect prose or exhaustive reasoning is made.

Accounted input includes repeated context across requests: uncached input plus
cache creation plus cache reads. It is not unique source volume. Cost is the CLI's
estimate, not an assertion of an additional cash charge. Total estimated usage:
$0.85313. Model preparation/evaluator effort is excluded.

## Decision and limitations

This fixture did not establish an accuracy problem for a workflow hint to fix.
Per the requested stopping rule, no hints were tested and no adaptive changes
were made after seeing answers.

The result is limited: nearly the entire small codebase could be read. Nesting,
interfaces, and exception wrapping alone did not defeat this agent here. This
does not establish performance on a 10,000-line application, on individually
presented requests, or with realistic repository navigation costs. The four
contrasting accounts in one task may also encourage comparison of account paths.
Three repetitions of these four cases are not twelve independent task samples.

## Reproduction and evidence

- [create-fixture.py](create-fixture.py) creates the full source/configuration tree.
- Existing checkout: `/Users/david/learning/nested-outcome-experiment/base`.
- Fixture commit: `ebbd808127bc0fe33a76061e1740ec97e9160a32`.
- [Pre-run protocol](evidence/protocol.json), [exact task](evidence/prompt.txt),
  [runtime outputs](evidence/actual-responses.txt), [usage](evidence/summary.json).
- [Answer 01](evidence/session-01-answer.md), [answer 02](evidence/session-02-answer.md),
  [answer 03](evidence/session-03-answer.md); corresponding tool-call records in evidence/.
- Raw transcripts and invocation settings:
  `.internal/engineering/nested-outcome-20260914/` in this worktree.
- Shared [session runner](../falsifiable-notes/run-session.py), with
  `--expected-revision` set to the fixture commit. Claude Code 2.1.47; two maximum
  concurrent sessions, fresh checkouts, identical neutral AGENTS.md instructions,
  no memory, hooks, skills invocation, MCP, web access or agent delegation.

All sessions finished without tool errors, permission denials or outside-root tool
paths. All tracked fixture files remained unchanged. No experiment processes remain.
