---
paths:
  - apps/web/**/*.ts
  - apps/web/**/*.html
  - apps/web/**/*.scss
---

# Angular Development Guidelines

This file is **Angular framework rules only**. Styling lives in `tailwind.md` + `spartan.md`,
auth client in `better-auth.md`, live streams in `sse.md`, and the `FE ↔ BE` data contract in
`contracts.md` - don't restate those here.

## Data & contracts

- Type API responses and form models from the shared Zod schema with `z.infer` - never declare
  a parallel `interface` for a shape that already lives in `@opspilot/shared`. See `contracts.md`.
- Fetch from `/api` with `httpResource()` (reactive, signal-based status/data/error). It is
  experimental in v21 and graduates to stable in v22; use `HttpClient` directly when you need
  full control. Do not hand-roll bare `fetch` in components.

## Project rules (deviate from / sharpen Angular defaults)

- Angular 21 is **zoneless by default** - no Zone.js in new projects; change detection is driven
  by signals and template events. Do NOT add Zone.js or `provideZoneChangeDetection`.

- Do NOT set `standalone: true` explicitly — it is the default in Angular v20+.
- Do NOT use `@HostBinding` / `@HostListener` decorators; use the `host` object in `@Component` / `@Directive` instead.
- Avoid `providedIn: 'root'`; provide services at the appropriate route or component level to keep scope explicit and traceable.
- Use `DestroyRef` with `onDestroy()` or `takeUntilDestroyed()` for cleanup; do NOT implement `ngOnDestroy` / `OnDestroy`.
- Use `afterNextRender()` for one-time DOM init that needs rendered elements; do NOT use `ngAfterViewInit`.
- Define `effect()` as named class fields (`private readonly someEffect = effect(() => { ... })`), never inside methods or unnamed in the constructor — keeps effect ownership explicit and traceable.
- On signals use `update()` / `set()`; do NOT use `mutate()`.
- Always use the new control flow (`@if`, `@for`, `@switch`); `*ngIf` / `*ngFor` / `*ngSwitch` only in code you are mid-migrating.

## Local thresholds (checkable on a diff)

- A component over ~150 lines of TS, or with more than one primary responsibility, must be split. *(assumed threshold — confirm)*
- In templates use only property/signal access and pipes; move any expression with a method call or conditional logic into a `computed()` or a component method.
- Lazy-load feature routes via `loadComponent` / `loadChildren`. Do not eager-load feature areas from the root routes.

## Structure (recommendation, not enforced)

- Prefer **feature/domain cohesion** over a layer-by-type topology (avoid `components/`/`services/`/`models/` god-folders); consult the Angular CLI MCP for the idiomatic skeleton.
- Web↔backend domain/feature alignment is owned by `contracts.md`; don't restate it here.

## Standard Angular best-practices

Hard requirements, checkable on a diff: every new component uses `ChangeDetectionStrategy.OnPush`; state via `signal()` / `computed()`; component I/O via `input()` / `output()`; DI via `inject()`; strict typing with no `any` (enforced by ESLint). For the rest of the official best-practices (native `[class.*]` / `[style.*]` over `ngClass` / `ngStyle`, `NgOptimizedImage`, Reactive Forms) and version-pinned conventions, consult the Angular CLI MCP server (below) rather than expanding this list here.

## Tooling source of truth

For Angular-related implementation decisions, consult MCP servers before making assumptions:

- **Angular CLI MCP server** — Angular patterns, best practices, and version-specific conventions.
- **Context7 MCP server** — up-to-date API documentation and third-party library references.

## Priority

1. Project code conventions
2. Angular CLI MCP server
3. Context7 MCP server
4. General model knowledge
