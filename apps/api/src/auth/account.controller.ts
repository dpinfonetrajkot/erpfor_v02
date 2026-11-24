import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  avatarPhotoSchema,
  companyAppearanceSchema,
  securityPolicySchema,
  twoFactorCodeSchema,
  twoFactorDisableSchema,
  userPreferencesSchema,
  type AvatarPhotoInput,
  type CompanyAppearance,
  type SecurityPolicy,
  type SessionUser,
  type TwoFactorCodeInput,
  type TwoFactorDisableInput,
  type TwoFactorSetup,
  type TwoFactorStatus,
  type UserPreferences,
} from '@bht/shared';
import { AuditAction } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { AllowDuringSetup, CurrentActor, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor, AuthUser } from '../common/auth-user';
import { AuthService } from './auth.service';
import { SecurityService } from './security.service';

/**
 * The Settings screen: each user changes only their own look, picture and 2-step login;
 * the company look and the company security rule need settings.update.
 */
@Controller()
export class AccountController {
  constructor(
    private readonly auth: AuthService,
    private readonly security: SecurityService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ my 2-step login

  @AllowDuringSetup()
  @Get('account/2fa')
  twoFactorStatus(@CurrentUser() user: AuthUser): Promise<TwoFactorStatus> {
    return this.security.status(user.id, user.permissions);
  }

  /** New secret for the authenticator app (shown as a QR code); not active until a code is confirmed. */
  @AllowDuringSetup()
  @Post('account/2fa/setup')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  twoFactorSetup(@CurrentUser() user: AuthUser): Promise<TwoFactorSetup> {
    return this.security.startSetup(user.id);
  }

  @AllowDuringSetup()
  @Post('account/2fa/enable')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  twoFactorEnable(@Body(new ZodValidationPipe(twoFactorCodeSchema)) body: TwoFactorCodeInput, @CurrentActor() actor: Actor): Promise<{ backupCodes: string[] }> {
    return this.security.enable(actor.userId, body.code, actor);
  }

  @Post('account/2fa/backup-codes')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  twoFactorBackupCodes(@Body(new ZodValidationPipe(twoFactorCodeSchema)) body: TwoFactorCodeInput, @CurrentActor() actor: Actor): Promise<{ backupCodes: string[] }> {
    return this.security.newBackupCodes(actor.userId, body.code, actor);
  }

  @Post('account/2fa/disable')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async twoFactorDisable(
    @Body(new ZodValidationPipe(twoFactorDisableSchema)) body: TwoFactorDisableInput,
    @CurrentUser() user: AuthUser,
    @CurrentActor() actor: Actor,
  ): Promise<void> {
    await this.security.disable(user.id, user.permissions, body.password, body.code, actor);
  }

  // ------------------------------------------------------------------ company security rule

  @Get('settings/security')
  @RequirePermission('settings.view')
  async securityPolicy(): Promise<SecurityPolicy> {
    return { twoFactor: await this.security.policy() };
  }

  @Put('settings/security')
  @RequirePermission('settings.update')
  setSecurityPolicy(@Body(new ZodValidationPipe(securityPolicySchema)) body: SecurityPolicy, @CurrentActor() actor: Actor): Promise<SecurityPolicy> {
    return this.security.setPolicy(body, actor);
  }

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
