import { AuditModule } from '@api/audit/audit.module';
import { CryptoModule } from '@api/crypto/crypto.module';
import { Module } from '@nestjs/common';

import { CredentialService } from './credential.service';

@Module({
  exports: [CredentialService],
  imports: [AuditModule, CryptoModule],
  providers: [CredentialService],
})
export class CredentialModule {}
