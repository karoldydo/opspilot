---
change_id: fix-skills-not-clickable-in-devices
title: Fix custom skills not clickable per service on /devices (regression)
status: implemented
created: 2026-06-22
updated: 2026-06-22
archived_at: null
---

## Notes

Regression: per the mockups, custom skills are run from /devices at the level of each managed service row (each in-scope skill renders as a clickable button that opens the run-skill dialog). In the current web UI these per-service skill buttons are not clickable / not surfaced, so although skills exist in the system there is no working way to run them from the UI. Goal: restore the mockup-faithful behavior so that on /devices, for every managed service, the applicable skills render as clickable buttons that open the run dialog and execute the skill. Scope: web only (apps/web/src/app/features/services/components/service-skills.component.* and device-services.component.*, plus the run-skill dialog and skills data client/store as needed); no design changes beyond the mockup. This is a regression fix, not a new feature.
