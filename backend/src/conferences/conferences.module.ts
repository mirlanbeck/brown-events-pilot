import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { ConferencesController } from './conferences.controller';
import { ConferencesService } from './conferences.service';

@Module({ imports: [SessionsModule], controllers: [ConferencesController], providers: [ConferencesService] })
export class ConferencesModule {}
