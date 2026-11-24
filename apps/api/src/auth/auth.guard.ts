import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { hasPermission } from '@bht/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOW_SETUP_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../common/decorators';
import { ACCESS_COOKIE } from './cookies';
import { SecurityService } from './security.service';

interface AccessPayload {
  sub: number;
  sid: number;
  /** Only set on the short 2-step sign-in pass, which is never a session. */
  purpose?: string;
}

/** Only touch users.last_seen_at once a minute per user. */
const LAST_SEEN_INTERVAL_MS = 60_000;

/**
 * Runs before every endpoint (registered globally):
 *  1. lets @Public() endpoints through
 *  2. checks the access token and that its session is still active
 *  3. re-reads the user + role from the database, so disabling a user or
 *     changing a role takes effect immediately
 *  4. holds back everything else while the user must still choose a new password or set up
 *     2-step login (only @AllowDuringSetup() endpoints are open then)
 *  5. checks @RequirePermission(...)
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly security: SecurityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[ACCESS_COOKIE] ?? bearer(req);
    if (!token) throw new UnauthorizedException('Please log in');

    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token);
    } catch {
      throw new UnauthorizedException('Session expired');
    }
    if (payload.purpose || typeof payload.sid !== 'number') throw new UnauthorizedException('Please log in');

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: {
        revokedAt: true,
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
            isActive: true,
            lastSeenAt: true,
            mustChangePassword: true,
            twoFactorEnabledAt: true,
            role: { select: { id: true, name: true, permissions: { select: { permission: true } } } },
          },
        },
      },
    });
    const user = session?.user;
    if (!session || session.revokedAt || !user || user.id !== payload.sub) {
      throw new UnauthorizedException('Session expired');
    }
    if (!user.isActive) throw new UnauthorizedException('Your account is disabled');

    const permissions = user.role.permissions.map((p) => p.permission);
    req.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      roleId: user.role.id,
      roleName: user.role.name,
      permissions,
      sessionId: payload.sid,
    };

    if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > LAST_SEEN_INTERVAL_MS) {
      void this.prisma.user
        .update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }

    if (!this.reflector.getAllAndOverride<boolean>(ALLOW_SETUP_KEY, targets)) {
      const needs2fa = !user.twoFactorEnabledAt && this.security.requiredFor(await this.security.policy(), permissions);
      if (user.mustChangePassword || needs2fa) {
        throw new ForbiddenException({
          message: user.mustChangePassword ? 'Please choose your own password first.' : 'Please set up 2-step login first.',
          code: 'ACCOUNT_SETUP_REQUIRED',
        });
      }
    }

    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, targets);
    if (required?.length && !required.some((p) => hasPermission(permissions, p))) {
      throw new ForbiddenException('You do not have permission for this action');
    }
    return true;
  }
}

function bearer(req: Request): string | undefined {
  const header = req.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}
