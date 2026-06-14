import { CryptoModule } from '@api/core/crypto/crypto.module';
import { AuditModule } from '@api/modules/audit/audit.module';
import { Module } from '@nestjs/common';

import { CredentialService } from './credential.service';

@Module({
  exports: [CredentialService],
  imports: [AuditModule, CryptoModule],
  providers: [CredentialService],
})
export class CredentialModule {}
