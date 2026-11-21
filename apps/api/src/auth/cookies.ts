import type { CookieOptions, Response } from 'express';
import type { IssuedTokens } from './auth.service';

export const ACCESS_COOKIE = 'erp2_at';
export const REFRESH_COOKIE = 'erp2_rt';

function base(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}

export function setAuthCookies(res: Response, tokens: IssuedTokens) {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...base(), maxAge: tokens.accessMaxAgeMs });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...base(), maxAge: tokens.refreshMaxAgeMs });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, base());
  res.clearCookie(REFRESH_COOKIE, base());
}
