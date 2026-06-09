import { ConfigType, registerAs } from '@nestjs/config';

// keep the value as the base64 string — decode to a 32-byte buffer at the
// crypto use site, not here (see plan critical details).
export const cryptoConfig = registerAs('crypto', () => ({
  encryptionKey: process.env.ENCRYPTION_KEY as string,
}));

export type CryptoConfig = ConfigType<typeof cryptoConfig>;
