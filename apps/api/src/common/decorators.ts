import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Actor, AuthUser } from './auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSIONS_KEY = 'permissions';
export const ALLOW_SETUP_KEY = 'allowDuringSetup';

/** Endpoint needs no login (login, refresh, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Endpoint stays open while the user still has to choose a new password or set up 2-step login
 * (everything else answers 403 ACCOUNT_SETUP_REQUIRED until that is done).
 */
export const AllowDuringSetup = () => SetMetadata(ALLOW_SETUP_KEY, true);

/** User needs at least one of these permissions, e.g. @RequirePermission('customers.view'). */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.user!;
});

/** { userId, ip } of the caller, for audit logging. */
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return { userId: req.user!.id, ip: req.ip ?? null };
});
