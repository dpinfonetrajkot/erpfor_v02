import { BadRequestException, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  hasPermission,
  IMPORT_MAX_MB,
  IMPORT_TYPE_INFO,
  IMPORT_TYPES,
  importQuerySchema,
  type ImportCheck,
  type ImportQuery,
  type ImportResult,
  type ImportType,
} from '@bht/shared';
import { CurrentActor, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor, AuthUser } from '../common/auth-user';
import { ImportsService, type Upload } from './imports.service';

/** Anyone who may import at least one kind of file gets past the first gate; each call then checks its own kind. */
const ANY_IMPORT = [...new Set(Object.values(IMPORT_TYPE_INFO).flatMap((i) => i.permissions))];

/** The file stays in memory only for the check / import (never written to disk). */
const upload = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: IMPORT_MAX_MB * 1024 * 1024, files: 1 } });

@Controller('imports')
@RequirePermission(...ANY_IMPORT)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** The empty Excel template for one kind of import. */
  @Get(':type/template')
  async template(@Param('type') type: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const t = this.allowed(type, user, 'skip');
    const { name, data } = await this.imports.template(t);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(data);
  }

  /** Reads the file and shows what would happen to every row. Nothing is saved. */
  @Post(':type/check')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(upload)
  check(
    @Param('type') type: string,
    @Query(new ZodValidationPipe(importQuerySchema)) q: ImportQuery,
    @UploadedFile() file: Upload | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<ImportCheck> {
    return this.imports.check(this.allowed(type, user, q.mode), file, q.mode, user);
  }

  /** Saves the good rows of the file (the browser sends the same file again). */
  @Post(':type')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(upload)
  run(
    @Param('type') type: string,
    @Query(new ZodValidationPipe(importQuerySchema)) q: ImportQuery,
    @UploadedFile() file: Upload | undefined,
    @CurrentUser() user: AuthUser,
    @CurrentActor() actor: Actor,
  ): Promise<ImportResult> {
    return this.imports.run(this.allowed(type, user, q.mode), file, q.mode, user, actor);
  }

  private allowed(type: string, user: AuthUser, mode: ImportQuery['mode']): ImportType {
    if (!(IMPORT_TYPES as readonly string[]).includes(type)) throw new BadRequestException('Unknown kind of import');
    const t = type as ImportType;
    const info = IMPORT_TYPE_INFO[t];
    const can = (p: string) => hasPermission(user.permissions, p);
    if (!info.permissions.every(can)) throw new ForbiddenException(`You do not have permission to import ${info.label.toLowerCase()}`);
    if (mode === 'update' && (!info.updatePermission || !can(info.updatePermission))) {
      throw new ForbiddenException(`You do not have permission to change ${info.label.toLowerCase()} that are already in the ERP`);
    }
    return t;
  }
}
