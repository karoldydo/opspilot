---
paths:
  - apps/web/**/*.ts
  - apps/web/**/*.html
  - apps/web/**/*.scss
---

# Angular Development Guidelines

## Project rules (deviate from / sharpen Angular defaults)

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

## Standard Angular best-practices

Follow the official Angular best-practices (signals + `computed()` for state, `input()` / `output()`, `inject()`, `ChangeDetectionStrategy.OnPush`, native `[class.*]` / `[style.*]` over `ngClass` / `ngStyle`, `NgOptimizedImage`, Reactive Forms, strict typing with no `any`). For specifics and version-pinned conventions consult the Angular CLI MCP server (below) rather than expanding this list.

## Tooling source of truth

For Angular-related implementation decisions, consult MCP servers before making assumptions:

- **Angular CLI MCP server** — Angular patterns, best practices, and version-specific conventions.
- **Context7 MCP server** — up-to-date API documentation and third-party library references.

## Priority

1. Project code conventions
2. Angular CLI MCP server
3. Context7 MCP server
4. General model knowledge
