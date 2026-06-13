import { z } from 'zod';

// the known service-derived field names a `service`-source parameter may bind to.
// these are read server-side from the resolved service row at run time and are
// never trusted from the client (skill-run.service.ts, phase 4), preserving the
// s-06 guarantee. kept in-file (not exported) to honor one-export-per-file.
const SERVICE_PARAMETER_NAMES = ['composePath', 'composeProject', 'containerName'];

// one typed parameter of a skill. `name` is a {{placeholder}}-legal identifier that
// must appear verbatim in the command template (parity is enforced in
// skill-create-request.schema.ts). `source` decides where the value comes from at
// run time: `service` = auto-filled from the resolved service row (constrained to
// the known service fields above); `input` = supplied by the caller in the run
// request. `required` marks whether a value must be present when the skill runs.
export const skillParameterSchema = z
  .strictObject({
    name: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, { error: 'parameter name must be a {{placeholder}}-legal identifier' }),
    required: z.boolean(),
    source: z.enum(['input', 'service']),
  })
  .refine((parameter) => parameter.source !== 'service' || SERVICE_PARAMETER_NAMES.includes(parameter.name), {
    error: "a 'service' parameter must bind to containerName, composePath, or composeProject",
  });

export type SkillParameter = z.infer<typeof skillParameterSchema>;
