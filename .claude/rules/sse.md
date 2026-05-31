---
paths:
  - apps/api/**/*.ts
  - apps/web/**/*.ts
---
# Server-Sent Events (live narration)

Live agent narration streams over **SSE**; an idle stream through the edge is reaped without
heartbeats. WebSocket is the fallback only if heartbeats prove insufficient (e.g. the edge keeps
reaping mid-run despite pings) — SSE stays the default.

## Server (`apps/api`)

- Expose the stream with NestJS `@Sse()` returning an `Observable<MessageEvent>` straight from a
  service; the controller is pass-through only — heartbeat, event mapping, and stream logic live in
  the service, never in the handler (see `nestjs.md`).
- Emit a `: ping\n\n` heartbeat every ~30 s so the connection is not reaped mid-run.
- Set `X-Accel-Buffering: no` and `Cache-Control: no-cache` on the response so the edge/proxy
  does not buffer the stream.

## Client (`apps/web`)

- Consume with the native `EventSource` and push events into a **signal** (the app is zoneless -
  an async `EventSource` callback does not trigger change detection on its own; signals do).
- Always tear the stream down: `destroyRef.onDestroy(() => source.close())` (use `DestroyRef`,
  never `ngOnDestroy` - see `angular.md`).
