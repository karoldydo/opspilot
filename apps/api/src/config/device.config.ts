import { ConfigType, registerAs } from '@nestjs/config';

// config-tunable, not a baked-in const (lessons.md); coerce with Number(...) — joi writes defaults back as strings.
export const deviceConfig = registerAs('device', () => ({
  credentialListLimit: Number(process.env.DEVICE_CREDENTIAL_LIST_LIMIT),
}));

export type DeviceConfig = ConfigType<typeof deviceConfig>;
