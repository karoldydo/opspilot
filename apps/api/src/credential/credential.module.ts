import { Module } from '@nestjs/common';

import { CryptoModule } from '../crypto/crypto.module';
import { CredentialService } from './credential.service';

@Module({
  exports: [CredentialService],
  imports: [CryptoModule],
  providers: [CredentialService],
})
export class CredentialModule {}
