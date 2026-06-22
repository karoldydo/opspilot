---
change_id: web-clickable-hover-affordance
title: Apply consistent clickable affordance across all interactive elements in apps/web
status: new
created: 2026-06-22
updated: 2026-06-22
archived_at: null
---

## Notes

Sweep the entire apps/web directory and find every clickable element (button, a, [routerLink], elements with a (click) handler, role="button", etc.), then give them a consistent clickable affordance (cursor-pointer + hover/focus-visible/active using the op-* tokens), analogous to the pattern applied in Phase 3 of the fix-skills-not-clickable-in-devices change (service-skills / device-services action buttons).
