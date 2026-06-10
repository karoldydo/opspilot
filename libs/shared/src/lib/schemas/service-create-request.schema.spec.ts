import { serviceCreateRequestSchema } from './service-create-request.schema';

describe('serviceCreateRequestSchema', () => {
  const valid = {
    containerName: 'nginx',
    deviceId: '22222222-2222-4222-8222-222222222222',
    name: 'web proxy',
  };

  it('parses a valid create body without compose fields', () => {
    expect(serviceCreateRequestSchema.parse(valid)).toEqual(valid);
  });

  it('parses compose project/path when present', () => {
    const withCompose = { ...valid, composePath: '/opt/stack/compose.yml', composeProject: 'stack' };
    expect(serviceCreateRequestSchema.parse(withCompose)).toEqual(withCompose);
  });

  it('rejects an empty name', () => {
    expect(serviceCreateRequestSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
  });

  it('rejects an empty containerName', () => {
    expect(serviceCreateRequestSchema.safeParse({ ...valid, containerName: '' }).success).toBe(false);
  });

  it('rejects a non-uuid deviceId', () => {
    expect(serviceCreateRequestSchema.safeParse({ ...valid, deviceId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects an unknown key (strict)', () => {
    expect(serviceCreateRequestSchema.safeParse({ ...valid, image: 'nginx:latest' }).success).toBe(false);
  });
});
