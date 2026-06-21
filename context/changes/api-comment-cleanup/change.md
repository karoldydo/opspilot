---
change_id: api-comment-cleanup
title: Clean up and trim comments in apps/api
status: implemented
created: 2026-06-21
updated: 2026-06-21
archived_at: null
---

## Notes

Clean up and trim comments in apps/api — remove redundant comments and shorten the ones that stay. Comments-only refactor, zero behavior change; the diff touches comment lines only.

Scope: all apps/api/src/**/*.ts, including test files *.spec.ts. Do not touch apps/web, libs/shared, or any config outside apps/api. ~105 .ts files, ~658 lines with // comments outside specs.

REMOVE a comment when it: restates verbatim what the code does (e.g. // increment the counter above i++, // inject the service above the constructor, // return the result above return); labels an obvious section already clear from the method/variable name; is commented-out dead code; breaks up a logical block and hurts readability while adding nothing; duplicates the same fact stated elsewhere (keep one, in the best place).

KEEP (but shorten) when the comment explains something NOT visible from the code: why it's done this way and not another (workaround, decision, trade-off); an edge case / gotcha / non-obvious ordering (e.g. global body parser disabled in main.ts, createdAt is an iso string on the wire never a Date, FK seeds, guard stubs in tests); a contract / invariant / reference to a rule (nestjs.md, lessons.md, key rotation). Tooling directives stay untouched: eslint-disable, ts-expect-error, @ts-ignore, pragmas, license headers, URL links, TODO/FIXME.

Style for the comments that stay: minimal, short, concise — one thought per comment; compliant with .claude/rules/comments.md (all lowercase, no capitalized first letter; applies to //, #, /* */, <!-- -->); prefer a single sharp line over a block.

Hard constraints: no changes to executable code — comments only; do not change names, signatures, imports, or code formatting outside the comment line; split files into batches per module (config/, common/, core/*, integrations/executor, modules/*) so the diff stays reviewable.

Verification (definition of done): npx nx lint api and npx nx test api pass the same as before the change; git diff shows comment lines only (no logic change); npm run format:check clean for apps/api.
