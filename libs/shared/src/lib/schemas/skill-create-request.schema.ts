import { z } from 'zod';

import { skillCommandTemplateSchema } from './skill-command-template.schema';
import { skillParameterSchema } from './skill-parameter.schema';

// extracts the {{placeholder}} names from a template (the placeholder grammar is the
// same identifier grammar as a parameter name) and checks set-equality against the
// declared parameter names — every placeholder has a matching parameter and vice-
// versa, so the skill is always renderable.
function placeholdersMatchParameters(template: string, parameters: { name: string }[]): boolean {
  const placeholders = new Set(
    [...template.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g)].map((match) => match[1])
  );
  const names = new Set(parameters.map((parameter) => parameter.name));
  if (placeholders.size !== names.size) return false;
  for (const name of names) if (!placeholders.has(name)) return false;
  return true;
}

// request body for creating a skill — user-authored fields only (no id/timestamps).
// `deviceId` omitted or null creates a global skill; a uuid scopes it to one device.
// `parameters` may be empty (a fixed command with no placeholders). the two cross-
// field refines enforce the skill's core invariant: parameter names are unique, and
// the template's {{placeholder}}s correspond exactly to the declared parameters.
// this is the single source of the parity rule — the update path re-validates the
// merged result against it (phase 3), since a partial patch may carry only one of
// commandTemplate/parameters.
export const skillCreateRequestSchema = z
  .strictObject({
    commandTemplate: skillCommandTemplateSchema,
    deviceId: z.uuid().nullable().optional(),
    name: z.string().min(1, { error: 'name is required' }),
    parameters: z.array(skillParameterSchema),
    timeoutMs: z.int().positive({ error: 'timeoutMs must be a positive integer' }).nullable().optional(),
  })
  .refine((skill) => new Set(skill.parameters.map((parameter) => parameter.name)).size === skill.parameters.length, {
    error: 'parameter names must be unique',
  })
  .refine((skill) => placeholdersMatchParameters(skill.commandTemplate, skill.parameters), {
    error: 'every {{placeholder}} must have a matching parameter and vice-versa',
  });

export type SkillCreateRequest = z.infer<typeof skillCreateRequestSchema>;
