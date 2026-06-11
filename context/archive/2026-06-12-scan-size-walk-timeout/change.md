---
change_id: scan-size-walk-timeout
title: Fix scan timeout from docker ps json forcing a layer-size walk
status: archived
created: 2026-06-12
updated: 2026-06-12
archived_at: 2026-06-12T01:04:11+02:00
---

## Notes

SCAN_COMMAND w apps/api service.service.ts używa `docker ps --format '{{json .}}'`, co wymusza liczenie rozmiaru warstw kontenerów (SizeRw/SizeRootFs); na wolnym storage Synology daemon przechodzi warstwy ~27 s i scan ociera się o 30 s SSH command timeout (losowe timeouty). Fix: zamienić whole-struct json na szablon z jawnymi polami (Names/Image/State/Status/Labels), bez .Size. Patrz lesson "Never list containers with docker ps --format '{{json .}}' / -s unless you need size".
