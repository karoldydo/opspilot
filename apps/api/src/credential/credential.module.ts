import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { CryptoModule } from '../crypto/crypto.module';
import { CredentialService } from './credential.service';

@Module({
  exports: [CredentialService],
  imports: [AuditModule, CryptoModule],
  providers: [CredentialService],
})
export class CredentialModule {}
