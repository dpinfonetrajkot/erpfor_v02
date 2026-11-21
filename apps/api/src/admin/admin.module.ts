import { Module } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { SettingsController } from './settings.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, RolesController, AuditLogController, SettingsController],
  providers: [UsersService, RolesService],
})
export class AdminModule {}
