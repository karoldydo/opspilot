import { Test, TestingModule } from '@nestjs/testing';

import { ConfigModule } from '../config/config.module';
import { cryptoConfig } from '../config/crypto.config';
import { CryptoModule } from './crypto.module';
import { CryptoService } from './crypto.service';

// unit: prove the aes-256-gcm round-trip, the non-deterministic iv, the gcm
// integrity guarantees (tampered tag/ciphertext throws), and the fail-fast
// wrong-size key assertion at construction.
describe('CryptoService', () => {
  // a fixed 32-byte key (0x01 * 32) base64-encoded to 44 chars.
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';

  async function build(encryptionKey: string): Promise<TestingModule> {
    return Test.createTestingModule({ imports: [ConfigModule, CryptoModule] })
      .overrideProvider(cryptoConfig.KEY)
      .useValue({ encryptionKey })
      .compile();
  }

  describe('with a valid key', () => {
    let service: CryptoService;

    beforeEach(async () => {
      const moduleRef = await build(inputKey);
      service = moduleRef.get(CryptoService);
    });

    it('round-trips: decrypt(encrypt(x)) === x', () => {
      const inputPlaintext = 'super-secret-ssh-password';
      const actual = service.decrypt(service.encrypt(inputPlaintext));
      expect(actual).toBe(inputPlaintext);
    });

    it('produces distinct iv and ciphertext for the same plaintext', () => {
      const inputPlaintext = 'same-plaintext';
      const first = service.encrypt(inputPlaintext);
      const second = service.encrypt(inputPlaintext);
      expect(first.iv).not.toBe(second.iv);
      expect(first.ciphertext).not.toBe(second.ciphertext);
    });

    it('throws when the auth tag is tampered with', () => {
      const encrypted = service.encrypt('payload');
      const tampered = { ...encrypted, authTag: Buffer.alloc(16, 9).toString('base64') };
      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('throws when the ciphertext is tampered with', () => {
      const encrypted = service.encrypt('payload');
      const bytes = Buffer.from(encrypted.ciphertext, 'base64');
      bytes[0] ^= 0xff;
      const tampered = { ...encrypted, ciphertext: bytes.toString('base64') };
      expect(() => service.decrypt(tampered)).toThrow();
    });
  });

  it('rejects a wrong-size key at construction', async () => {
    // 16 bytes (0x02 * 16) base64 — structurally valid base64 but decodes to
    // half the required key length, so construction must fail fast.
    const shortKey = Buffer.alloc(16, 2).toString('base64');
    await expect(build(shortKey)).rejects.toThrow(/32 bytes/);
  });
});
