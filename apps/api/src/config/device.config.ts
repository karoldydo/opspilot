import { ConfigType, registerAs } from '@nestjs/config';

// device-domain tunables. the credential-list default page size is config, not a
// baked-in literal — joi writes the default back to process.env as a string, so
// coerce with Number(...) (see lessons.md config-tunable rule).
export const deviceConfig = registerAs('device', () => ({
  credentialListLimit: Number(process.env.DEVICE_CREDENTIAL_LIST_LIMIT),
}));

export type DeviceConfig = ConfigType<typeof deviceConfig>;
