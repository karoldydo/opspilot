import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json } from 'express';

import { CryptoModule } from '../crypto/crypto.module';
import { LlmProviderController } from './llm-provider.controller';
import { LlmProviderService } from './llm-provider.service';

@Module({
  controllers: [LlmProviderController],
  exports: [LlmProviderService],
  imports: [CryptoModule],
  providers: [LlmProviderService],
})
export class LlmProviderModule implements NestModule {
  configure(middlewareConsumer: MiddlewareConsumer): void {
    // the global body parser is disabled (main.ts: bodyParser false) so better-auth's
    // catch-all node handler receives the raw body; domain routes must re-apply json().
    middlewareConsumer.apply(json()).forRoutes(LlmProviderController);
  }
}
