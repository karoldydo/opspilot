import { z } from 'zod';

// the closed set of auditable actions (s-09): one string per mutating endpoint
// across device / service / skill / llm-provider / credential plus the diagnose
// run. the single source of truth for both the api insert and the web filter.
// dotted `entity.verb` names mirror the inventory in research.md Area 3.
export const auditActionSchema = z.enum([
  'credential.create',
  'credential.delete',
  'device.create',
  'device.delete',
  'device.update',
  'diagnose.run',
  'llmProvider.activate',
  'llmProvider.create',
  'llmProvider.delete',
  'llmProvider.update',
  'service.create',
  'service.delete',
  'service.scan',
  'service.update',
  'skill.create',
  'skill.delete',
  'skill.run',
  'skill.update',
]);

export type AuditAction = z.infer<typeof auditActionSchema>;
