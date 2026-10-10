import { Module } from '@nestjs/common';
import { SessionRegistrationsController } from './session-registrations.controller';
import { SessionRegistrationsService } from './session-registrations.service';

@Module({ controllers: [SessionRegistrationsController], providers: [SessionRegistrationsService] })
export class SessionRegistrationsModule {}
