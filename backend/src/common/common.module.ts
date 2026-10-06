import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/app-config';
import { Clock, SystemClock } from './clock';

@Global()
@Module({
  providers: [
    { provide: AppConfig, inject: [ConfigService], useFactory: (config: ConfigService) => config.getOrThrow<AppConfig>('app') },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [AppConfig, Clock],
})
export class CommonModule {}
