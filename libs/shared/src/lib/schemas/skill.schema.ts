import { z } from 'zod';

import { skillCommandTemplateSchema } from './skill-command-template.schema';
import { skillParameterSchema } from './skill-parameter.schema';

// accepts either a wire-level iso string (raw http/json) or a date the drizzle row
// carries (timestamp_ms decodes to a date), normalizing both to an iso string — the
// render contract stays a string regardless of the source.
const isoTimestamp = z.preprocess((value) => (value instanceof Date ? value.toISOString() : value), z.iso.datetime());

// the canonical persisted skill shape returned to clients. `deviceId === null`
// marks a global skill (visible on every device); a uuid scopes it to one device.
// `timeoutMs === null` inherits the config default (skill.config.ts, phase 4). the
// command template and the declared parameters are kept consistent at the write
// boundary (skill-create-request.schema.ts parity refine; the update path re-checks
// the merged row), so this read shape stays structural. z.strictObject rejects any
// leaked column.
export const skillSchema = z.strictObject({
  commandTemplate: skillCommandTemplateSchema,
  createdAt: isoTimestamp,
  deviceId: z.uuid().nullable(),
  id: z.uuid(),
  name: z.string().min(1, { error: 'name is required' }),
  parameters: z.array(skillParameterSchema),
  timeoutMs: z.int().positive().nullable(),
  updatedAt: isoTimestamp,
});

export type Skill = z.infer<typeof skillSchema>;
