import { BadRequestException, Body, Controller, Get, Param, Put, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { tallyExportQuerySchema, tallySettingsSchema, type TallyExportQuery, type TallyPreview, type TallySettings } from '@bht/shared';
import { CurrentActor, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor, AuthUser } from '../common/auth-user';
import { TallyService } from './tally.service';

@Controller('tally')
@RequirePermission('tally.export')
export class TallyController {
  constructor(private readonly tally: TallyService) {}

  @Get('settings')
  settings(): Promise<TallySettings> {
    return this.tally.settings();
  }

  @Put('settings')
  saveSettings(@Body(new ZodValidationPipe(tallySettingsSchema)) body: TallySettings, @CurrentActor() actor: Actor): Promise<TallySettings> {
    return this.tally.saveSettings(body, actor);
  }

  @Get('preview')
  preview(@Query(new ZodValidationPipe(tallyExportQuerySchema)) q: TallyExportQuery): Promise<TallyPreview> {
    return this.tally.preview(q);
  }

  /** The import file: "ledgers" (import first) or "vouchers". */
  @Get('export/:part')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async export(
    @Param('part') part: string,
    @Query(new ZodValidationPipe(tallyExportQuerySchema)) q: TallyExportQuery,
    @CurrentUser() user: AuthUser,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ) {
    if (part !== 'ledgers' && part !== 'vouchers') throw new BadRequestException('Choose ledgers or vouchers');
    const { name, xml } = await this.tally.file(part, q, user, actor);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(xml);
  }
}
