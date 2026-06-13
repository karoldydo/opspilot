import { describe, expect, it } from 'vitest';

import { skillCommandTemplateSchema } from './skill-command-template.schema';

describe('skillCommandTemplateSchema', () => {
  it('accepts a template with well-formed placeholders', () => {
    expect(skillCommandTemplateSchema.safeParse('docker start {{containerName}}').success).toBe(true);
    expect(
      skillCommandTemplateSchema.safeParse('docker compose -f {{composePath}} -p {{composeProject}} up -d').success
    ).toBe(true);
    expect(skillCommandTemplateSchema.safeParse('docker logs --tail 100 {{ containerName }}').success).toBe(true);
  });

  it('accepts a fixed command with no placeholders', () => {
    expect(skillCommandTemplateSchema.safeParse('docker ps').success).toBe(true);
  });

  it('rejects an empty template', () => {
    expect(skillCommandTemplateSchema.safeParse('').success).toBe(false);
  });

  it('rejects a malformed {{placeholder}}', () => {
    expect(skillCommandTemplateSchema.safeParse('docker start {{}}').success).toBe(false);
    expect(skillCommandTemplateSchema.safeParse('docker start {{1name}}').success).toBe(false);
    expect(skillCommandTemplateSchema.safeParse('docker start {{a-b}}').success).toBe(false);
    expect(skillCommandTemplateSchema.safeParse('docker start {{a b}}').success).toBe(false);
  });
});
