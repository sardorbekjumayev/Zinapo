import { CookieOptions, Request, Response } from 'express';
import { AppConfig } from '../config/configuration';
import { ACCESS_TTL_SEC, REFRESH_TTL_SEC } from './session.service';
import { LIMITS } from './login-request.types';

export const COOKIE_LOGIN = 'zn_login';
export const COOKIE_ACCESS = 'zn_at';
export const COOKIE_REFRESH = 'zn_rt';

function base(config: AppConfig, maxAgeSec: number): CookieOptions {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSec * 1000,
  };
}

export function setLoginCookie(res: Response, config: AppConfig, secret: string): void {
  res.cookie(COOKIE_LOGIN, secret, base(config, LIMITS.requestTtlSec));
}

export function clearLoginCookie(res: Response, config: AppConfig): void {
  res.clearCookie(COOKIE_LOGIN, { ...base(config, 0), maxAge: undefined });
}

export function setSessionCookies(
  res: Response,
  config: AppConfig,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(COOKIE_ACCESS, tokens.accessToken, base(config, ACCESS_TTL_SEC));
  res.cookie(COOKIE_REFRESH, tokens.refreshToken, base(config, REFRESH_TTL_SEC));
}

export function clearSessionCookies(res: Response, config: AppConfig): void {
  const opts = { ...base(config, 0), maxAge: undefined };
  res.clearCookie(COOKIE_ACCESS, opts);
  res.clearCookie(COOKIE_REFRESH, opts);
}

export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first ?? req.ip ?? '').trim();
}

export function userAgent(req: Request): string {
  return (req.headers['user-agent'] ?? '').toString().slice(0, 300);
}
