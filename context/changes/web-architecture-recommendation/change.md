---
change_id: web-architecture-recommendation
title: Restructure apps/web to a feature-sliced architecture
status: implementing
created: 2026-06-14
updated: 2026-06-14
archived_at: null
---

## Notes

Seed: `.ai/web-architecture-recommendation.md` — approved recommendation to move
`apps/web` from a layer-by-type topology (`core/clients`, `core/stores` god-folders)
to a feature-sliced layout (`features/<domain>/{data,dialogs,components}`), keep
`core/` for cross-cutting only, add a `@app/*` path alias, and migrate domain-by-domain
with `git mv`. The document carries the target tree, placement rules, before→after file
mapping, and a step-by-step migration plan (section 7) to execute under this change.
