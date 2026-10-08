import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppConfig, CONFIG } from '../config/configuration';
import { AuditService } from '../common/audit.service';
import { maskPhone, toE164 } from '../common/phone.util';
import { randomToken, sha256 } from '../common/crypto.util';
import { RedisService } from '../redis/redis.service';
import { StartDto } from './dto/start.dto';
import { StatusQueryDto, VerifyDto } from './dto/verify.dto';
import { LoginRequestService } from './login-request.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import { LIMITS, TERMINAL_STATUSES } from './login-request.types';
import {
  COOKIE_LOGIN,
  COOKIE_REFRESH,
  clearLoginCookie,
  clearSessionCookies,
  clientIp,
  setLoginCookie,
  setSessionCookies,
  userAgent,
} from './cookies';
import {
  CodeExpiredException,
  LockedException,
  RateLimitedException,
  RequestExpiredException,
} from './auth.errors';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly login: LoginRequestService,
    private readonly otp: OtpService,
    private readonly session: SessionService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ start

  @Post('telegram/start')
  @HttpCode(200)
  async start(@Body() dto: StartDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const phone = toE164(dto.phone);
    if (!phone) throw new BadRequestException({ error: 'PHONE_INVALID' });

    const lang = dto.lang ?? 'uz';
    const ip = clientIp(req);
    const ua = userAgent(req);

    await this.enforceStartRateLimit(phone, ip);

    const bindSecret = randomToken(24);
    const { request, deepLink } = await this.login.create({ phone, lang, bindSecret, ua, ip });

    setLoginCookie(res, this.config, bindSecret);

    await this.audit.write({
      action: 'auth.start',
      payload: { requestId: request.id, phone: maskPhone(phone), lang },
      ip,
      userAgent: ua,
    });

    // No enumeration: identical shape whether or not the phone is registered.
    return {
      requestId: request.id,
      deepLink,
      expiresAt: new Date(request.expiresAt).toISOString(),
    };
  }

  // ------------------------------------------------------------ status

  @Get('telegram/status')
  async status(@Query() query: StatusQueryDto, @Req() req: Request) {
    const bindSecret = req.cookies?.[COOKIE_LOGIN];
    if (!bindSecret) throw new UnauthorizedException({ error: 'BROWSER_MISMATCH' });

    const request = await this.login.find(query.requestId);
    if (request && request.bindHash !== sha256(bindSecret)) {
      throw new UnauthorizedException({ error: 'BROWSER_MISMATCH' });
    }

    const status = this.login.effectiveStatus(request);
    const codeLive = request?.codeExpiresAt != null && request.codeExpiresAt > Date.now();

    return {
      status,
      codeExpiresAt: codeLive ? new Date(request!.codeExpiresAt!).toISOString() : null,
      attemptsLeft: request ? Math.max(0, LIMITS.maxAttempts - request.attempts) : 0,
      codesLeft: request ? Math.max(0, LIMITS.maxCodes - request.codesIssued) : 0,
      expiresAt: request ? new Date(request.expiresAt).toISOString() : null,
      terminal: TERMINAL_STATUSES.includes(status),
    };
  }

  // ------------------------------------------------------------ verify

  @Post('telegram/verify')
  @HttpCode(200)
  async verify(@Body() dto: VerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = clientIp(req);
    const ua = userAgent(req);

    const allowed = await this.redis.rateLimit(
      `rl:verify:ip:${ip}`,
      LIMITS.verifyPerIp.limit,
      LIMITS.verifyPerIp.ttlSec,
    );
    if (!allowed) throw new RateLimitedException(LIMITS.verifyPerIp.ttlSec);

    const bindSecret = req.cookies?.[COOKIE_LOGIN];
    if (!bindSecret) throw new UnauthorizedException({ error: 'BROWSER_MISMATCH' });

    const begin = await this.login.verifyBegin(dto.requestId, bindSecret);

    if (!begin.ok) {
      switch (begin.reason) {
        case 'BROWSER_MISMATCH':
          throw new UnauthorizedException({ error: 'BROWSER_MISMATCH' });
        case 'PHONE_MISMATCH':
          throw new ConflictException({ error: 'PHONE_MISMATCH' });
        case 'LOCKED':
          throw new LockedException();
        case 'CODE_EXPIRED':
        case 'NO_CODE':
          throw new CodeExpiredException();
        case 'CANCELLED':
        case 'ALREADY_VERIFIED':
        case 'REQUEST_EXPIRED':
        default:
          throw new RequestExpiredException();
      }
    }

    const expected = this.otp.hash(dto.requestId, dto.code);
    if (!this.otp.equals(expected, begin.codeHash)) {
      if (begin.attemptsLeft <= 0) {
        await this.login.markLocked(dto.requestId);
        await this.audit.write({
          action: 'auth.locked',
          payload: { requestId: dto.requestId },
          ip,
          userAgent: ua,
        });
        throw new LockedException();
      }
      await this.audit.write({
        action: 'auth.verify_failed',
        payload: { requestId: dto.requestId, attemptsLeft: begin.attemptsLeft },
        ip,
        userAgent: ua,
      });
      throw new BadRequestException({ error: 'CODE_INVALID', attemptsLeft: begin.attemptsLeft });
    }

    const request = await this.login.find(dto.requestId);
    if (!request || request.tgUserId === null) throw new RequestExpiredException();

    await this.login.markVerified(request.id);

    const { person, isNewUser } = await this.session.upsertPerson({
      phone: request.phone,
      lang: request.lang,
      telegramUserId: request.tgUserId,
      firstName: request.firstName,
      lastName: request.lastName,
    });

    const tokens = await this.session.issue(person.id, { ua, ip });
    setSessionCookies(res, this.config, tokens);
    clearLoginCookie(res, this.config);
    await this.login.drop(request.id);

    await this.audit.write({
      action: 'auth.login',
      personId: person.id,
      payload: { requestId: request.id, isNewUser },
      ip,
      userAgent: ua,
    });

    return { next: '/dashboard', isNewUser };
  }

  // ------------------------------------------------------------ session

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[COOKIE_REFRESH];
    if (!token) throw new UnauthorizedException({ error: 'REFRESH_INVALID' });

    const ip = clientIp(req);
    const ua = userAgent(req);
    const rotated = await this.session.rotate(token, { ua, ip });

    setSessionCookies(res, this.config, rotated);
    await this.audit.write({ action: 'auth.refresh', personId: rotated.personId, ip, userAgent: ua });
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[COOKIE_REFRESH];
    const personId = token ? await this.session.revoke(token) : null;
    clearSessionCookies(res, this.config);
    clearLoginCookie(res, this.config);
    if (personId) {
      await this.audit.write({ action: 'auth.logout', personId, ip: clientIp(req) });
    }
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const token = req.cookies?.['zn_at'];
    if (!token) throw new UnauthorizedException({ error: 'UNAUTHENTICATED' });
    let sub: string;
    try {
      ({ sub } = await this.session.verifyAccessToken(token));
    } catch {
      throw new UnauthorizedException({ error: 'UNAUTHENTICATED' });
    }
    const person = await this.session.findPerson(sub);
    if (!person) throw new UnauthorizedException({ error: 'UNAUTHENTICATED' });
    return { id: person.id, fullName: person.full_name, phone: person.phone, locale: person.locale };
  }

  // ------------------------------------------------------------ helpers

  private async enforceStartRateLimit(phone: string, ip: string): Promise<void> {
    const phoneKey = `rl:start:phone:${phone}`;
    const ipKey = `rl:start:ip:${ip}`;

    const byPhone = await this.redis.rateLimit(
      phoneKey,
      LIMITS.startPerPhone.limit,
      LIMITS.startPerPhone.ttlSec,
    );
    if (!byPhone) throw new RateLimitedException(await this.retryAfter(phoneKey, LIMITS.startPerPhone.ttlSec));

    const byIp = await this.redis.rateLimit(ipKey, LIMITS.startPerIp.limit, LIMITS.startPerIp.ttlSec);
    if (!byIp) throw new RateLimitedException(await this.retryAfter(ipKey, LIMITS.startPerIp.ttlSec));
  }

  private async retryAfter(key: string, fallback: number): Promise<number> {
    const ttl = await this.redis.ttl(key);
    return ttl > 0 ? ttl : fallback;
  }
}
