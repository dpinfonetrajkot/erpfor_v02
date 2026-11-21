import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  type ChangePasswordInput,
  type LoginInput,
  type SessionUser,
} from '@bht/shared';
import { CurrentActor, CurrentUser, Public } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor, AuthUser } from '../common/auth-user';
import { AuthService } from './auth.service';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from './cookies';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionUser> {
    const { tokens, user } = await this.auth.login(body.username, body.password, clientInfo(req));
    setAuthCookies(res, tokens);
    return user;
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(204)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    try {
      const tokens = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], clientInfo(req));
      setAuthCookies(res, tokens);
    } catch (err) {
      clearAuthCookies(res);
      throw err instanceof UnauthorizedException ? err : new UnauthorizedException('Session expired');
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthUser,
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user.sessionId, actor);
    clearAuthCookies(res);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<SessionUser> {
    return this.auth.me(user.id);
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    await this.auth.changePassword(user.id, user.sessionId, body, actor);
  }
}

function clientInfo(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}
