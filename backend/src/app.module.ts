import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { ConferencesModule } from './conferences/conferences.module';
import { loadConfig } from './config/app-config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { SpeakersModule } from './speakers/speakers.module';

@Module({})
export class AppModule {
  // env is a parameter (not process.env read at import time) so that tests can start apps with different settings.
  static forRoot(env: Record<string, string | undefined>): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ app: loadConfig(env) })] }),
        CommonModule,
        PrismaModule,
        HealthModule,
        SpeakersModule,
        ConferencesModule,
      ],
    };
  }
}
