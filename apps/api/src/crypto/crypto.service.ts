import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { cryptoConfig, CryptoConfig } from '../config/crypto.config';
import { EncryptedPayload } from './encrypted-payload.type';

// aes-256-gcm: 32-byte key, 12-byte iv (gcm standard), 16-byte auth tag.
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(@Inject(cryptoConfig.KEY) private readonly config: CryptoConfig) {
    // joi validates base64 + 44-char encoded length, but not the decoded byte
    // length — assert it here so a structurally-valid-but-wrong-size key fails
    // fast at construction rather than at first encrypt.
    const key = Buffer.from(this.config.encryptionKey, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(`encryption key must decode to ${KEY_BYTES} bytes, got ${key.length}`);
    }
    this.key = key;
  }

  decrypt(input: EncryptedPayload): string {
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(input.iv, 'base64'));
    // setAuthTag before final() so a tampered ciphertext/tag throws instead of
    // returning garbage (gcm integrity).
    decipher.setAuthTag(Buffer.from(input.authTag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(input.ciphertext, 'base64')), decipher.final()]);
    return plaintext.toString('utf8');
  }

  encrypt(plaintext: string): EncryptedPayload {
    // random per-record iv gives semantic security: same plaintext encrypts to
    // distinct ciphertext each call.
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
    };
  }
}
