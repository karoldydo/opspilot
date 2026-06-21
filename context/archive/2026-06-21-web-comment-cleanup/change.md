---
change_id: web-comment-cleanup
title: Clean up and trim comments in apps/web
status: archived
created: 2026-06-21
updated: 2026-06-21
archived_at: 2026-06-21T17:12:39Z
---

## Notes

Clean up and trim comments in apps/web — remove redundant comments and shorten the ones that stay. Comments-only refactor, zero behavior change; the diff touches comment lines only.

Scope: all apps/web/src/**/*.ts, including test files *.spec.ts, plus *.html templates and *.scss. Do not touch apps/api, libs/shared, or any config outside apps/web. ~38 non-spec .ts files + 17 *.spec.ts, ~396 lines with // comments outside specs (34 in specs); html has 0 comments and scss 1 today, so they're in scope only if a stray comment appears.

REMOVE a comment when it: restates verbatim what the code does (e.g. // inject the service above inject(), // navigate to login above router.navigate, // return the signal above return); labels an obvious section already clear from the component/method/signal name; is commented-out dead code or a leftover scaffold comment from the Angular generator; breaks up a logical block and hurts readability while adding nothing; duplicates the same fact stated elsewhere (keep one, in the best place).

KEEP (but shorten) when the comment explains something NOT visible from the code: why it's done this way and not another (workaround, decision, trade-off); an edge case / gotcha / non-obvious ordering (e.g. interceptor ordering, why an effect runs untracked, a guard's redirect rationale, an http error swallowed on purpose, SSE/stream reconnection notes); a contract / invariant / reference to a rule (contracts.md, angular.md, zod schema from @opspilot/shared). Tooling directives stay untouched: eslint-disable, ts-expect-error, @ts-ignore, angular template control-flow, pragmas, license headers, URL links, TODO/FIXME.

Style for the comments that stay: minimal, short, concise — one thought per comment; compliant with .claude/rules/comments.md (all lowercase, no capitalized first letter; applies to //, #, /* */, <!-- -->); prefer a single sharp line over a block.

Hard constraints: no changes to executable code — comments only; do not change names, signatures, imports, template markup, or code formatting outside the comment line; split files into batches per Angular structure (core/{auth,guards,interceptors}, shared/, then one batch per feature: audit, auth, devices, diagnosis, home, llm-providers, services, skills) so the diff stays reviewable.

Verification (definition of done): npx nx lint web and npx nx test web pass the same as before the change; git diff shows comment lines only (no logic/template change); npm run format:check clean for apps/web.
