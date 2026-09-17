# Implementation discipline

Tool-agnostic craft for implementing one phase of a plan well. This is the *how you write the code* layer — it deliberately says nothing about gates, staging, commits, or Progress checkboxes; those are the caller's job, never the implementer's.

## Follow the plan's intent, adapt to reality

The plan is the guide, not a literal script. Implement what the phase is *for*, and adapt to what you actually find in the codebase. Adapting means adjusting a coordinate — a moved file, a renamed symbol, an import path — to reach the plan's intended end state. It never means redesigning the phase, adding scope the plan didn't ask for, or reinterpreting its goal. When the codebase and the plan disagree, classify the gap before you act:

- **Minor** — a moved file, a renamed symbol, import drift, a trivial API/config delta. Intent is intact; only a coordinate changed. Adapt, and record the adaptation in one line (`ADAPT: plan says src/auth.ts, file is now src/auth/index.ts`).
- **Structural** — a missing dependency, an architecture that differs from what the plan assumes, a referenced file/API that does not exist, a phase depending on output a prior phase never produced. The plan cannot be followed as written and adapting would mean redesigning it. Do NOT guess a redesign — stop and report it back to the caller with the specifics.

When in doubt between the two, treat it as structural. A wrong "stop" costs one resume; a wrong "adapt" can ship a redesign nobody approved.

## Read before you write

- Read every file the phase references — research, frame, and the source files it will touch — **fully**. Never use limit/offset; you need complete context to avoid breaking callers you didn't read.
- Before editing a file, understand its existing conventions: naming, error handling, import style, test layout, the patterns of its neighbors. Your change should read like the surrounding code, not like a graft.

## Implement the whole phase, coherently

- Implement the phase's changes fully — every item in its Changes Required — before you consider yourself done. A half-applied phase is worse than an untouched one; it breaks the caller's gate stack in ways that look like the plan's fault.
- Verify the change fits the broader codebase as you go: does it compile against real call sites, honor existing types, and match the module's established shape? A change that satisfies the phase description in isolation but contradicts the surrounding architecture is not done.

## Apply the team's accepted rules

Every rule in `context/foundation/lessons.md` (passed to you by the caller) is a recurring pitfall the team has already paid for. Treat each one as a hard constraint on this implementation, not advice. If a rule and the plan appear to conflict, prefer the rule and flag the tension in your report rather than silently choosing.

## When you're stuck or in unfamiliar territory

Don't thrash by editing blindly. When a file, subsystem, or failure is unfamiliar:

1. **Search first.** Use an `Explore` sub-search to locate the relevant code, similar patterns, or the real call sites before changing anything.
2. **Reason, then edit.** Form a specific hypothesis about what the correct change is and why, then make it — rather than trying edits until something sticks.
3. **Consider codebase drift.** The plan may have been written against an earlier state of the repo. If reality has moved, that's a mismatch to classify (Minor → adapt; Structural → report), not a puzzle to force.

If, after searching and reasoning, the right value or behavior is genuinely ambiguous — the plan and the code disagree and there's no independent source of truth — do not guess. Report it as an uncertainty so a human can resolve it, and leave the implementation honest rather than inventing a plausible answer.
