import { CryptoModule } from '@api/core/crypto/crypto.module';
import { AuditModule } from '@api/modules/audit/audit.module';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json } from 'express';

import { LlmProviderClientFactory } from './llm-provider.client-factory';
import { LlmProviderController } from './llm-provider.controller';
import { LlmProviderProbe } from './llm-provider.probe';
import { LlmProviderService } from './llm-provider.service';

@Module({
  controllers: [LlmProviderController],
  exports: [LlmProviderClientFactory, LlmProviderService],
  imports: [AuditModule, CryptoModule],
  providers: [LlmProviderClientFactory, LlmProviderProbe, LlmProviderService],
})
export class LlmProviderModule implements NestModule {
  configure(middlewareConsumer: MiddlewareConsumer): void {
    // global body parser disabled in main.ts (better-auth raw body); re-apply json() here
    middlewareConsumer.apply(json()).forRoutes(LlmProviderController);
  }
}
