import { ConfigType, registerAs } from '@nestjs/config';

// keep as the base64 string; decode to a 32-byte buffer at the crypto use site, not here.
export const cryptoConfig = registerAs('crypto', () => ({
  encryptionKey: process.env.ENCRYPTION_KEY as string,
}));

export type CryptoConfig = ConfigType<typeof cryptoConfig>;
