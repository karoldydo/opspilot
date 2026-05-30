---
project: opspilot
version: 1
status: active
created: 2026-05-31
updated: 2026-05-31
source_of_truth: context/foundation/roadmap.md
backlog: github-issues (karoldydo/opspilot)
---

# Task management: roadmap -> GitHub Issues

How opspilot's work is tracked. The **roadmap is the source of truth**; GitHub Issues is the
**working backlog** derived from it. On any divergence, `context/foundation/roadmap.md` wins and
the issues are re-synced to match - never the other way around.

## The two layers

| Layer           | Artifact                              | Role                                                         |
|-----------------|---------------------------------------|--------------------------------------------------------------|
| Source of truth | `context/foundation/roadmap.md` (v1)  | Sequencing, rationale, risk, dependency graph, north star.   |
| Working backlog | GitHub Issues on `karoldydo/opspilot` | Trackable, assignable, filterable units derived 1:1 from it. |

Each issue body ends with a `Source:` footer pointing back to the roadmap. GitHub **Projects v2 is
out of scope** (the `gh` token lacks the `project` scope); we use Issues + Labels + Milestones +
native issue dependencies only.

## Issue inventory (roadmap ID -> issue #)

21 issues total: 12 roadmap items + 2 open questions + 7 parked.

| Issue | Roadmap ID | Title                                                   | Milestone | Type                   |
|-------|------------|---------------------------------------------------------|-----------|------------------------|
| #1    | F-01       | Wire DB persistence + shared validation scaffold        | M1        | foundation             |
| #2    | F-02       | Account auth + route guard (flat, no roles)             | M1        | foundation             |
| #3    | F-03       | Encrypted-at-rest store for SSH credentials             | M1        | foundation             |
| #4    | S-01       | Manage devices (add/edit/delete, SSH creds)             | M1        | slice                  |
| #5    | S-02       | Scan containers and curate managed services             | M1        | slice                  |
| #6    | S-03       | Configure custom LLM provider                           | M1        | slice                  |
| #7    | S-04       | Diagnose a service -> structured 4-field synthesis      | M1        | slice / **north-star** |
| #8    | S-05       | Live agent narration + transcript replay (SSE)          | M2        | slice                  |
| #9    | S-06       | Deterministic ops: start/stop/restart/up/down           | M2        | slice                  |
| #10   | S-07       | Per-device agent system prompt                          | M2        | slice                  |
| #11   | S-08       | Custom skill CRUD (global / per-device)                 | M2        | slice                  |
| #12   | S-09       | Audit log + linked history view                         | M2        | slice                  |
| #13   | OQ-1       | Decide: management of the SSH-credential encryption key | M1        | question               |
| #14   | OQ-2       | Decide: source of truth for audit identity              | M2        | question               |
| #15   | P-1        | LAN device auto-discovery (FR-003)                      | -         | parked                 |
| #16   | P-2        | Chat / free-form prompts to the agent                   | -         | parked                 |
| #17   | P-3        | Metrics monitoring (CPU/RAM/disk)                       | -         | parked                 |
| #18   | P-4        | User-defined LLM output schemas via the UI              | -         | parked                 |
| #19   | P-5        | Roles / RBAC                                            | -         | parked                 |
| #20   | P-6        | v2 operations bundle (updates, scheduling, ...)         | -         | parked                 |
| #21   | P-7        | Platform / UX scope cuts (mobile, i18n, theming, ...)   | -         | parked                 |

## Conventions

### Titles

`[<roadmap-id>] <suggested title>` - e.g. `[F-01] Wire DB persistence + shared validation scaffold`.
Open questions use `[OQ-n] Decide: ...`; parked items use `[PARKED] ...`. The bracketed ID is the
stable handle linking an issue back to its roadmap row.

### Body template (F / S items)

Issues are written **entirely in English** (matching the roadmap). Field text is quoted 1:1 from
the roadmap. Sections: a header line (`Roadmap ID | Change ID | Stream`), then `## Outcome`,
`## PRD refs`, `## Unlocks` (foundations only), `## Unknowns` (only when present), `## Risk`,
`## Dependencies`, and the `Source:` footer.

### Labels

| Dimension | Labels                              | Meaning                                                                                                                    |
|-----------|-------------------------------------|----------------------------------------------------------------------------------------------------------------------------|
| Type      | `type: foundation`, `type: slice`   | F-NN bounded enabler vs S-NN vertical slice.                                                                               |
| Stream    | `stream: A` .. `stream: E`          | Parallel track from the roadmap (A=foundation, B=onboarding, C=diagnosis core, D=ops & programmability, E=accountability). |
| Status    | `status: ready`, `status: proposed` | Mirrors the roadmap `Status` field.                                                                                        |
| Special   | `north-star`                        | The validation milestone (S-04 only).                                                                                      |
| Parked    | `parked`                            | Deferred / out of MVP scope.                                                                                               |
| Question  | `question` (built-in)               | An open roadmap decision (OQ-1, OQ-2).                                                                                     |

### Milestones (delivery phases)

- **`M1 - Foundation & North Star (MVP)`** - everything needed to reach the north star: F-01, F-02,
  F-03, S-01, S-02, S-03, S-04 (+ OQ-1, which it soft-blocks). 8 issues.
- **`M2 - Post-MVP`** - the remaining slices: S-05, S-06, S-07, S-08, S-09 (+ OQ-2). 6 issues.
- Parked items carry **no** milestone.

### Dependencies (native "blocked by")

Prerequisites are encoded as GitHub **native issue dependencies** (the "Blocked by" section in the
issue UI), not just text. Set via the GraphQL `addBlockedBy` mutation. 18 edges:

```
F-02  <- F-01                 S-05  <- S-04
F-03  <- F-01, OQ-1           S-06  <- S-02, S-04
S-01  <- F-02, F-03           S-07  <- S-01, S-04
S-02  <- S-01                 S-08  <- S-06
S-03  <- F-02                 S-09  <- F-02, S-04, OQ-2
S-04  <- S-02, S-03
```

`X <- Y` reads "X is blocked by Y". F-01 has no blockers (it is the root of every chain and the
single `status: ready` item).

## Working with the backlog

- **Pick next work:** start from `status: ready` items with no open blockers (today: F-01 / #1).
  GitHub greys out issues that are still blocked.
- **Filter by track:** use `stream:` labels to see a parallel chain; `milestone:` for phase scope.
- **Keep in sync:** if the roadmap changes (new slice, re-sequencing, status flip), update
  `roadmap.md` first, then reflect it in the issue (title, labels, blocked-by edges).
- **Re-running the migration:** the one-shot generator lives at
  `scripts/migrate-roadmap-issues.sh` (creates labels, milestones, issues, and dependency edges).
  It is **not** idempotent for issues - running it again on a populated repo would duplicate them.

## Useful commands

```bash
export GH_REPO="karoldydo/opspilot"

# the backlog at a glance
gh issue list --state all --limit 50

# one stream / one phase
gh issue list --label "stream: C"
gh issue list --milestone "M1 - Foundation & North Star (MVP)"

# milestone progress
gh api "repos/$GH_REPO/milestones" --jq '.[] | "\(.title): \(.open_issues) open"'

# inspect an issue's blockers
gh api graphql -f query='{repository(owner:"karoldydo",name:"opspilot"){issue(number:7){title blockedBy(first:10){nodes{number title}}}}}'
```
