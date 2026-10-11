import { Module } from '@nestjs/common';
import { AttendeesController } from './attendees.controller';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

@Module({ controllers: [RegistrationsController, AttendeesController], providers: [RegistrationsService] })
export class RegistrationsModule {}
