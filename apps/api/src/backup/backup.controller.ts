import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { backupSettingsSchema, type BackupOverview, type BackupRun, type BackupSettings } from '@bht/shared';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../common/auth-user';
import { BackupService } from './backup.service';

/** A backup holds all company data (and password hashes), so every action needs settings.update. */
@Controller('settings/backups')
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Get()
  @RequirePermission('settings.update')
  overview(): Promise<BackupOverview> {
    return this.backups.overview();
  }

  @Put('settings')
  @RequirePermission('settings.update')
  saveSettings(@Body(new ZodValidationPipe(backupSettingsSchema)) body: BackupSettings, @CurrentActor() actor: Actor): Promise<BackupOverview> {
    return this.backups.saveSettings(body, actor);
  }

  @Post()
  @RequirePermission('settings.update')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  backupNow(@CurrentActor() actor: Actor): Promise<BackupRun> {
    return this.backups.backupNow(actor);
  }

  @Get(':name/download')
  @RequirePermission('settings.update')
  async download(@Param('name') name: string, @CurrentActor() actor: Actor, @Res() res: Response) {
    const path = await this.backups.pathOf(name);
    await this.backups.logDownload(name, actor);
    res.setHeader('Cache-Control', 'no-store');
    res.download(path, name, { headers: { 'Content-Type': 'application/gzip' } });
  }

  @Delete(':name')
  @HttpCode(204)
  @RequirePermission('settings.update')
  remove(@Param('name') name: string, @CurrentActor() actor: Actor): Promise<void> {
    return this.backups.remove(name, actor);
  }
}
