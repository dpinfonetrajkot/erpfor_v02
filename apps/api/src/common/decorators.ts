import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Actor, AuthUser } from './auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSIONS_KEY = 'permissions';

/** Endpoint needs no login (login, refresh, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

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
