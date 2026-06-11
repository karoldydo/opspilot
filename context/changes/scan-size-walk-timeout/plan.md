# Fix scan timeout from `docker ps {{json .}}` forcing a layer-size walk — Implementation Plan

## Overview

`ServiceService.scan()` lists live containers over SSH with `docker ps --format '{{json .}}'`. Marshalling the whole container struct makes the docker CLI compute per-container layer sizes (`SizeRw`/`SizeRootFs`) — the same cost as passing `-s`. On the Synology NAS's slow storage the daemon walks every container's layers for ~27 s, brushing the 30 s SSH command timeout, so the scan times out intermittently. The fix replaces the whole-struct json with an explicit-field JSON-object template (`Names`/`Image`/`State`/`Status`/`Labels`, no `.Size`), which the lesson measured at ~0.02 s.

## Current State Analysis

- `apps/api/src/service/service.service.ts:27-29` — `SCAN_COMMAND` is `export PATH=...; docker ps --format '{{json .}}' --no-trunc`. The `{{json .}}` whole-struct marshal is the root cause.
- `apps/api/src/service/service.service.ts:125-136` — `parseContainer(line)` does `JSON.parse(line)` and reads `raw.Names`, `raw.Image`, `raw.State`, `raw.Status`, `raw.Labels`. As long as the new format emits a JSON **object** with those exact keys, this method is unchanged.
- `apps/api/src/service/service.service.spec.ts:108-112` — the happy-path test asserts the **exact** command string. It builds its NDJSON fixtures with `JSON.stringify({ Names, Image, State, Status, Labels })` (lines 76-85), i.e. objects with the same keys — so the parse assertions stay valid; only the command-string assertion must change.
- Comments referencing `{{json .}}`: `service.service.ts:23-26` (header above `SCAN_COMMAND`), `service.service.ts:123-124` (`parseContainer` doc), and `libs/shared/src/lib/schemas/scan-result.schema.ts:5` (schema doc).
- The empirical root-cause analysis is recorded in `context/foundation/lessons.md:40-45` ("Never list containers with `docker ps --format '{{json .}}'` / `-s` unless you need size").

## Desired End State

`POST /devices/:id/scan` runs a `docker ps` whose format enumerates explicit fields and never triggers the layer-size walk, so the command returns in well under a second even on the Synology's slow storage and never brushes the SSH timeout. The parsed `ScanResult` is byte-for-byte identical to before for any given set of containers. Verified by: the updated unit spec passes, and a live `time docker ps ...` on the NAS shows the new command at <1 s vs the old `{{json .}}` at ~27 s.

### Key Discoveries:

- `{{json .Field}}` per-field already emits a JSON-quoted string, so a template like `{"Names":{{json .Names}},...}` produces valid JSON per line and safely escapes spaces, commas, and quotes in names/labels — no delimiter-collision risk (`service.service.ts:141-154` `parseLabels` still handles the flat `key=value,key=value` label string).
- Keeping the JSON-**object** shape (not an array) means `parseContainer` keeps reading `raw.Names`/etc. unchanged — minimal blast radius.
- `--no-trunc` must stay: it keeps full names/labels (compose project/path are read out of `Labels`).

## What We're NOT Doing

- Not parameterizing or changing the SSH command timeout — the lesson shows the fixed command runs in ~0.02 s, so the timeout stops being a factor; a config-layer timeout tunable is a separate, larger change.
- Not adding retry/backoff, telemetry, or scan-duration metrics.
- Not changing the `ScannedContainer`/`ScanResult` Zod contracts, the executor, or any API/route shape.
- Not switching the wire format to a JSON array or tab-delimited encoding.

## Implementation Approach

Single-file behavior change: swap the `SCAN_COMMAND` format from `'{{json .}}'` to an explicit-field JSON-object template, update the one test assertion that pins the command string, and refresh the three comments that describe the old format. Then verify live on the NAS that the layer-size walk is gone.

## Phase 1: Replace whole-struct json with an explicit-field template

### Overview

Change the scan command so docker emits only the fields the parser consumes, eliminating the per-container layer-size walk, and align tests + docs.

### Changes Required:

#### 1. Scan command format

**File**: `apps/api/src/service/service.service.ts`

**Intent**: Replace the `{{json .}}` whole-struct marshal (which forces `SizeRw`/`SizeRootFs` computation) with an explicit-field JSON-object template carrying only `Names`, `Image`, `State`, `Status`, `Labels`. `parseContainer` reads the same keys, so it stays untouched. Keep the `PATH` prefix and `--no-trunc`.

**Contract**: `SCAN_COMMAND` (line 27-29) becomes the same `export PATH=...; docker ps --no-trunc --format <template>`, where `<template>` is a single-quoted Go template emitting one JSON object per line with explicitly-named fields and **no** `.Size`/`.Sizes`. The emitted line must `JSON.parse` to an object exposing `Names`, `Image`, `State`, `Status`, `Labels` (string) — matching `parseContainer`'s reads. Example template body:

```
'{"Names":{{json .Names}},"Image":{{json .Image}},"State":{{json .State}},"Status":{{json .Status}},"Labels":{{json .Labels}}}'
```

#### 2. Comments describing the format

**File**: `apps/api/src/service/service.service.ts`

**Intent**: Update the two comments that name `{{json .}}` so they describe the explicit-field template, keeping the lowercase-comment rule (`.claude/rules/comments.md`).

**Contract**: Header comment above `SCAN_COMMAND` (lines 23-26) and the `parseContainer` doc comment (lines 123-124) — replace the `'{{json .}}'` references with the explicit-field-template description; the lines are still NDJSON of JSON objects.

#### 3. Schema doc comment

**File**: `libs/shared/src/lib/schemas/scan-result.schema.ts`

**Intent**: Refresh the doc comment that references `docker ps --format '{{json .}}'` so it matches the new explicit-field source. Comment-only; no schema/shape change.

**Contract**: Comment at lines 5-9 — reword the `{{json .}}` mention; `scannedContainerSchema`/`scanResultSchema` are unchanged.

#### 4. Command-string assertion

**File**: `apps/api/src/service/service.service.spec.ts`

**Intent**: Update the happy-path test's exact-command assertion to the new format string. The NDJSON fixtures (lines 76-85) already build objects with the same keys, so the parse expectations (lines 90-107) stay as-is.

**Contract**: The `expect(mockExecutor.execute).toHaveBeenCalledWith(inputDeviceId, ...)` string at lines 108-112 must equal the new `SCAN_COMMAND`. No other test changes.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx nx test api -- src/service/service.service.spec.ts`
- Full api test target passes: `npx nx test api`
- Lint passes: `npx nx lint api` and `npx nx lint shared`
- Type/build passes: `npx nx build api`
- No remaining `{{json .}}` in the scan path: `grep -rn "json .}}" apps/api/src/service libs/shared/src/lib/schemas/scan-result.schema.ts` returns nothing.

#### Manual Verification:

- On the Synology NAS via MCP SSH (`mcp__ssh-synology__exec`), `cd /volume1/docker/opspilot` with the docker `PATH` prefix (`ssh.md`), and `time` the **new** command — confirm it returns in <1 s and emits one valid JSON object per line for each running container.
- For contrast, `time` the **old** `docker ps --format '{{json .}}' --no-trunc` on the same host — confirm it takes ~tens of seconds, proving the layer-size walk was the cause.
- Trigger a scan from the running app against the Synology device and confirm the curation UI lists containers with correct compose project/path and no intermittent timeout.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the live NAS timing + UI check succeeded before closing the change.

---

## Testing Strategy

### Unit Tests:

- The existing `service.service.spec.ts` "parses docker ps NDJSON into a ScanResult" case continues to exercise label derivation and the two-container parse; only the command-string assertion is updated.
- Error-mapping cases (127 → `DockerNotFoundError`, daemon-down → `DockerDaemonDownError`) are format-independent and remain green.

### Integration Tests:

- None added — the executor is mocked at the service boundary and the wire shape into `parseContainer` is unchanged.

### Manual Testing Steps:

1. SSH to the NAS, run the new command under `time`, confirm <1 s and valid per-line JSON objects.
2. Run the old `{{json .}}` command under `time` on the same host for the before/after contrast.
3. Scan the Synology device from the app UI; verify container list + compose labels and absence of timeout.

## Performance Considerations

This change **is** the performance fix: it removes the per-container layer-size walk (~27 s on slow storage) that caused the intermittent 30 s timeout. No new hotspots introduced.

## Migration Notes

None — no persisted data, schema, or contract changes; the scan result is ephemeral.

## References

- Root-cause lesson: `context/foundation/lessons.md:40-45`
- Scan command + parser: `apps/api/src/service/service.service.ts:27-29`, `:125-136`
- Pinned-command test: `apps/api/src/service/service.service.spec.ts:108-112`
- Remote SSH rules: `.claude/rules/ssh.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Replace whole-struct json with an explicit-field template

#### Automated

- [x] 1.1 Unit tests pass: `npx nx test api -- src/service/service.service.spec.ts`
- [x] 1.2 Full api test target passes: `npx nx test api`
- [x] 1.3 Lint passes: `npx nx lint api` and `npx nx lint shared`
- [x] 1.4 Type/build passes: `npx nx build api`
- [x] 1.5 No remaining `{{json .}}` in the scan path (grep returns nothing)

#### Manual

- [x] 1.6 New command on NAS via MCP SSH returns <1 s with one valid JSON object per running container
- [x] 1.7 Old `{{json .}}` command on the same host times in tens of seconds (before/after contrast)
- [x] 1.8 Scan from the app UI lists containers with correct compose labels and no intermittent timeout
