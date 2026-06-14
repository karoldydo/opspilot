import { AuditModule } from '@api/audit/audit.module';
import { CryptoModule } from '@api/core/crypto/crypto.module';
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
    // the global body parser is disabled (main.ts: bodyParser false) so better-auth's
    // catch-all node handler receives the raw body; domain routes must re-apply json().
    middlewareConsumer.apply(json()).forRoutes(LlmProviderController);
  }
}
