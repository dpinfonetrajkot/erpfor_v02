import { Body, Controller, Get, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  avatarPhotoSchema,
  companyAppearanceSchema,
  userPreferencesSchema,
  type AvatarPhotoInput,
  type CompanyAppearance,
  type SessionUser,
  type UserPreferences,
} from '@bht/shared';
import { AuditAction } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { CurrentActor, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor, AuthUser } from '../common/auth-user';
import { AuthService } from './auth.service';

/** The Settings screen: each user changes only their own look and picture; the company look needs settings.update. */
@Controller()
export class AccountController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Put('account/preferences')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  preferences(@Body(new ZodValidationPipe(userPreferencesSchema)) body: UserPreferences, @CurrentUser() user: AuthUser): Promise<SessionUser> {
    return this.auth.updatePreferences(user.id, body);
  }

  @Put('account/avatar')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  avatar(@Body(new ZodValidationPipe(avatarPhotoSchema)) body: AvatarPhotoInput, @CurrentUser() user: AuthUser): Promise<SessionUser> {
    return this.auth.updateAvatar(user.id, body.photo);
  }

  /** Any logged-in user may read the company look (it is applied to every screen). */
  @Get('settings/appearance')
  appearance(): Promise<CompanyAppearance> {
    return this.auth.appearance();
  }

  @Put('settings/appearance')
  @RequirePermission('settings.update')
  async setAppearance(@Body(new ZodValidationPipe(companyAppearanceSchema)) body: CompanyAppearance, @CurrentActor() actor: Actor): Promise<CompanyAppearance> {
    const before = await this.auth.appearance();
    await this.prisma.$transaction(
      Object.entries(body).map(([k, value]) =>
        this.prisma.appSetting.upsert({ where: { key: `ui.${k}` }, create: { key: `ui.${k}`, value }, update: { value } }),
      ),
    );
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'settings',
      summary: `Company look: font ${before.font} → ${body.font}, colour ${before.accent} → ${body.accent}`,
    });
    return this.auth.appearance();
  }
}
