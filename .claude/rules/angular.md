---
paths:
  - apps/web/**/*.ts
  - apps/web/**/*.html
  - apps/web/**/*.scss
---

# Angular Development Guidelines

Use modern Angular patterns and keep implementations maintainable and performant.

## Guidelines

- Prefer standalone components, directives, and pipes. Do NOT set `standalone: true` explicitly — it is the default in Angular v20+.
- Prefer signals for local reactive state and `computed()` for derived state. Use `update()` / `set()` on signals; do NOT use `mutate()`.
- Use `ChangeDetectionStrategy.OnPush` for all components.
- Prefer `input()` / `output()` functions over `@Input()` / `@Output()` decorators.
- Prefer `inject()` when it improves readability and avoids constructor noise.
- Do NOT use `@HostBinding` / `@HostListener` decorators; use the `host` object in `@Component` / `@Directive` instead.
- Keep components focused and small (single responsibility).
- Keep templates simple; move complex logic to TypeScript.
- Prefer new control flow syntax (`@if`, `@for`, `@switch`) over legacy structural directives when appropriate.
- Avoid `ngClass` and `ngStyle` where native `[class.*]` and `[style.*]` bindings are sufficient.
- Avoid `any`; use strict, explicit typing and `unknown` where needed.
- Use lazy loading and performance-friendly defaults.
- Prefer Reactive Forms over Template-driven forms.
- Use `NgOptimizedImage` for static images.
- Avoid `providedIn: 'root'`; provide services at the appropriate module or component level to keep scope explicit and traceable.
- Prefer `DestroyRef` with `onDestroy()` or `takeUntilDestroyed()` over `ngOnDestroy` / `implements OnDestroy` for cleanup logic.
- Prefer `afterNextRender()` over `ngAfterViewInit` for one-time DOM initialization that requires rendered elements.
- Define `effect()` as named class fields (`private readonly someEffect = effect(() => { ... })`), not inside methods or unnamed in the constructor. This improves traceability and makes effect ownership explicit.

## Tooling source of truth

For Angular-related implementation decisions, consult MCP servers before making assumptions:

- **Angular CLI MCP server** — Angular patterns, best practices, and version-specific conventions.
- **Context7 MCP server** — up-to-date API documentation and third-party library references.

## Priority

1. Project code conventions
2. Angular CLI MCP server
3. Context7 MCP server
4. General model knowledge
