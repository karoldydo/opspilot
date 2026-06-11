import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { authConfig } from './auth.config';
import { cryptoConfig } from './crypto.config';
import { databaseConfig } from './database.config';
import { deviceConfig } from './device.config';
import { envSchema } from './env.schema';
import { llmConfig } from './llm.config';
import { operationConfig } from './operation.config';
import { sshConfig } from './ssh.config';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [authConfig, cryptoConfig, databaseConfig, deviceConfig, llmConfig, operationConfig, sshConfig],
      validationOptions: { abortEarly: false, allowUnknown: true },
      validationSchema: envSchema,
    }),
  ],
})
export class ConfigModule {}
