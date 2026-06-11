# Fix scan timeout from `docker ps {{json .}}` — Plan Brief

> Full plan: `context/changes/scan-size-walk-timeout/plan.md`

## What & Why

`ServiceService.scan()` lists containers over SSH with `docker ps --format '{{json .}}'`. Marshalling the whole container struct makes the docker CLI compute per-container layer sizes (`SizeRw`/`SizeRootFs`) — exactly as `-s` does. On the Synology NAS's slow storage that walk takes ~27 s and brushes the 30 s SSH command timeout, so scans time out intermittently. Swapping to an explicit-field template (measured ~0.02 s) removes the walk.

## Starting Point

`SCAN_COMMAND` (`apps/api/src/service/service.service.ts:27-29`) uses `{{json .}}`. `parseContainer` (`:125-136`) `JSON.parse`s each NDJSON line and reads `raw.Names/Image/State/Status/Labels`. One unit test (`service.service.spec.ts:108-112`) pins the exact command string.

## Desired End State

The scan command enumerates only the fields the parser consumes, never triggering the layer-size walk; it returns in <1 s on the NAS and produces a byte-identical `ScanResult`. Container curation no longer times out.

## Key Decisions Made

| Decision                  | Choice                                  | Why (1 sentence)                                                                 | Source |
| ------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| Format encoding           | JSON-object with explicit fields        | Keeps `parseContainer` unchanged (same keys) and json-per-field escapes safely. | Plan   |
| Scope                     | Format fix only (no timeout change)     | Fixed command runs ~0.02 s, so the timeout stops mattering; smallest diff.       | Plan   |
| Verification              | Live `time` on NAS via MCP SSH          | Proves the real storage-walk cause on the target host, not just in a unit test.  | Plan   |

## Scope

**In scope:** `SCAN_COMMAND` format string; the one command-string test assertion; three comments referencing `{{json .}}` (service header, `parseContainer` doc, `scan-result.schema.ts` doc).

**Out of scope:** SSH timeout tunable, retry/telemetry, contract/schema/API/executor changes, array/tab-delimited encodings.

## Architecture / Approach

Single-file behavior change. New format: `'{"Names":{{json .Names}},"Image":{{json .Image}},"State":{{json .State}},"Status":{{json .Status}},"Labels":{{json .Labels}}}'` (keep the `PATH` prefix and `--no-trunc`). `parseContainer` and the Zod contracts are untouched.

## Phases at a Glance

| Phase                                | What it delivers                          | Key risk                                            |
| ------------------------------------ | ----------------------------------------- | --------------------------------------------------- |
| 1. Explicit-field template + tests   | Fast scan command, updated test + comments | Go-template quoting in the shell single-quoted arg  |

**Prerequisites:** Access to the live Synology NAS (MCP SSH) for the timing verification.
**Estimated effort:** ~1 short session, single phase.

## Open Risks & Assumptions

- Assumes the Go template `{"Names":{{json .Names}},...}` parses cleanly inside the shell single-quoted `--format` arg (escaping verified by the live SSH run).
- Assumes no other caller depends on fields beyond `Names/Image/State/Status/Labels` from the scan (confirmed: `parseContainer` reads only these).

## Success Criteria (Summary)

- Scan command returns in <1 s on the NAS (vs ~27 s for the old `{{json .}}`), shown by a before/after `time`.
- `npx nx test api` and lint/build pass with the updated assertion; no `{{json .}}` left in the scan path.
- App UI scan lists containers with correct compose labels and no intermittent timeout.
