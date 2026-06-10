import { z } from 'zod';

// one detected container parsed out of `docker ps --format '{{json .}}'` NDJSON.
// carries live runtime facts (image/state/status) for the curation UI only —
// these are never persisted onto a service row. compose project/path are derived
// from the container labels and nullable for standalone containers. the backend
// validates each parsed NDJSON line against this shape.
export const scannedContainerSchema = z.strictObject({
  composePath: z.string().nullable(),
  composeProject: z.string().nullable(),
  containerName: z.string(),
  image: z.string(),
  state: z.string(),
  status: z.string(),
});

export type ScannedContainer = z.infer<typeof scannedContainerSchema>;

// the ephemeral shape POST /devices/:id/scan returns — every detected container
// with live facts, for the curation UI only; never persisted.
export const scanResultSchema = z.strictObject({
  containers: scannedContainerSchema.array(),
});

export type ScanResult = z.infer<typeof scanResultSchema>;
