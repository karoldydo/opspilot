import { z } from 'zod';

// a skill's command structure: fixed literal text plus {{name}} placeholders that
// are the *only* dynamic content (no free shell). each placeholder name must be a
// legal identifier (^[a-zA-Z][a-zA-Z0-9_]*$ — the same grammar as a parameter
// name) so it matches 1:1 against a declared parameter; that parity check lives in
// skill-create-request.schema.ts (it needs both fields). the values substituted for
// placeholders are charset-constrained at render time
// (skill-parameter-value.schema.ts) — the injection guard is on the substituted
// values, the template text itself is operator-authored config. this refine only
// rejects a malformed brace pair (e.g. `{{}}`, `{{1x}}`, `{{a-b}}`, `{{ a b }}`).
export const skillCommandTemplateSchema = z
  .string()
  .min(1, { error: 'commandTemplate is required' })
  .refine(
    (template) =>
      (template.match(/\{\{[^}]*\}\}/g) ?? []).every((token) => /^\{\{\s*[a-zA-Z][a-zA-Z0-9_]*\s*\}\}$/.test(token)),
    { error: 'commandTemplate has a malformed {{placeholder}}' }
  );

export type SkillCommandTemplate = z.infer<typeof skillCommandTemplateSchema>;
