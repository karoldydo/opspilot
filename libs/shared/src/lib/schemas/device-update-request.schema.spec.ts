import { deviceUpdateRequestSchema } from './device-update-request.schema';

describe('deviceUpdateRequestSchema', () => {
  it('accepts a partial patch with a single field', () => {
    expect(deviceUpdateRequestSchema.parse({ name: 'nas-2' })).toEqual({ name: 'nas-2' });
    expect(deviceUpdateRequestSchema.parse({ host: '192.168.1.20' })).toEqual({ host: '192.168.1.20' });
  });

  it('accepts a patch with both fields', () => {
    const patch = { host: '192.168.1.20', name: 'nas-2' };
    expect(deviceUpdateRequestSchema.parse(patch)).toEqual(patch);
  });

  it('rejects an empty patch (at least one field required)', () => {
    expect(deviceUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown key (strict)', () => {
    expect(deviceUpdateRequestSchema.safeParse({ name: 'nas', secret: 'x' }).success).toBe(false);
  });
});
