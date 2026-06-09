import { deviceCreateRequestSchema } from './device-create-request.schema';

describe('deviceCreateRequestSchema', () => {
  it('parses a valid create body', () => {
    const valid = { host: '192.168.1.10', name: 'nas' };
    expect(deviceCreateRequestSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an empty name', () => {
    expect(deviceCreateRequestSchema.safeParse({ host: '192.168.1.10', name: '' }).success).toBe(false);
  });

  it('rejects an empty host', () => {
    expect(deviceCreateRequestSchema.safeParse({ host: '', name: 'nas' }).success).toBe(false);
  });

  it('rejects an unknown key (strict) — no secret material enters here', () => {
    expect(
      deviceCreateRequestSchema.safeParse({ host: '192.168.1.10', name: 'nas', secret: 'super-secret' }).success
    ).toBe(false);
  });
});
