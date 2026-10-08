import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/configuration';
import { RedisService } from '../redis/redis.service';
import { newRequestId, randomToken, sha256 } from '../common/crypto.util';
import {
  Lang,
  LIMITS,
  LoginRequest,
  LoginStatus,
  TERMINAL_STATUSES,
} from './login-request.types';
import { OtpService } from './otp.service';

/**
 * Attempt-counting and code issuing happen inside Lua so that two concurrent
 * requests can never share an attempt slot. The HMAC compare itself stays in
 * Node (Redis has no HMAC): `verifyBegin` counts the attempt and *then* hands
 * back the stored digest, so aborting after the Lua call buys an attacker
 * nothing — the attempt is already spent.
 */
const VERIFY_BEGIN_LUA = `
local raw = redis.call('HGETALL', KEYS[1])
if #raw == 0 then return {'REQUEST_EXPIRED'} end
local h = {}
for i = 1, #raw, 2 do h[raw[i]] = raw[i + 1] end
if h['bindHash'] ~= ARGV[2] then return {'BROWSER_MISMATCH'} end
local status = h['status']
if status == 'LOCKED' then return {'LOCKED'} end
if status == 'PHONE_MISMATCH' then return {'PHONE_MISMATCH'} end
if status == 'CANCELLED' then return {'CANCELLED'} end
if status == 'VERIFIED' then return {'ALREADY_VERIFIED'} end
if status ~= 'CODE_SENT' then return {'NO_CODE'} end
local now = tonumber(ARGV[1])
-- Unset hash fields are stored as '' and tonumber('') is nil, not 0.
local exp = tonumber(h['codeExpiresAt']) or 0
if exp <= now then return {'CODE_EXPIRED'} end
local maxAttempts = tonumber(ARGV[3])
local attempts = (tonumber(h['attempts']) or 0) + 1
if attempts > maxAttempts then
  redis.call('HSET', KEYS[1], 'status', 'LOCKED')
  return {'LOCKED'}
end
redis.call('HSET', KEYS[1], 'attempts', tostring(attempts))
return {'OK', h['codeHash'], tostring(maxAttempts - attempts)}
`;

const ISSUE_CODE_LUA = `
local raw = redis.call('HGETALL', KEYS[1])
if #raw == 0 then return {'NOT_FOUND'} end
local h = {}
for i = 1, #raw, 2 do h[raw[i]] = raw[i + 1] end
local status = h['status']
if status ~= 'TG_LINKED' and status ~= 'CODE_SENT' then return {'BAD_STATUS', status} end
local codeHash, now, codeExpiresAt = ARGV[1], tonumber(ARGV[2]), ARGV[3]
local maxCodes, cooldownMs = tonumber(ARGV[4]), tonumber(ARGV[5])
-- Unset hash fields are stored as '' and tonumber('') is nil, not 0.
local codesIssued = tonumber(h['codesIssued']) or 0
if codesIssued >= maxCodes then return {'MAX_CODES'} end
local lastCodeAt = tonumber(h['lastCodeAt']) or 0
if lastCodeAt > 0 and (now - lastCodeAt) < cooldownMs then
  return {'COOLDOWN', tostring(math.ceil((cooldownMs - (now - lastCodeAt)) / 1000))}
end
redis.call('HSET', KEYS[1],
  'codeHash', codeHash,
  'codeExpiresAt', codeExpiresAt,
  'attempts', '0',
  'status', 'CODE_SENT',
  'codesIssued', tostring(codesIssued + 1),
  'lastCodeAt', ARGV[2])
return {'OK', tostring(maxCodes - codesIssued - 1)}
`;

type LuaResult = string[];

export type IssueCodeResult =
  | { ok: true; code: string; codeExpiresAt: number; codesLeft: number }
  | { ok: false; reason: 'NOT_FOUND' | 'MAX_CODES' | 'BAD_STATUS'; status?: string }
  | { ok: false; reason: 'COOLDOWN'; retryAfter: number };

export type VerifyBeginResult =
  | { ok: true; codeHash: string; attemptsLeft: number }
  | {
      ok: false;
      reason:
        | 'REQUEST_EXPIRED'
        | 'BROWSER_MISMATCH'
        | 'LOCKED'
        | 'PHONE_MISMATCH'
        | 'CANCELLED'
        | 'ALREADY_VERIFIED'
        | 'NO_CODE'
        | 'CODE_EXPIRED';
    };

@Injectable()
export class LoginRequestService implements OnModuleInit {
  private readonly logger = new Logger(LoginRequestService.name);
  private verifyBeginSha = '';
  private issueCodeSha = '';

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly redis: RedisService,
    private readonly otp: OtpService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.verifyBeginSha = await this.redis.client.script('LOAD', VERIFY_BEGIN_LUA) as string;
    this.issueCodeSha = await this.redis.client.script('LOAD', ISSUE_CODE_LUA) as string;
  }

  // ---------------------------------------------------------------- keys

  private reqKey(id: string): string {
    return `login:req:${id}`;
  }
  private tokKey(tokenHash: string): string {
    return `login:tok:${tokenHash}`;
  }
  private browserKey(bindHash: string): string {
    return `login:browser:${bindHash}`;
  }
  private tgKey(tgUserId: number): string {
    return `login:tg:${tgUserId}`;
  }

  // ---------------------------------------------------------------- create

  async create(input: {
    phone: string;
    lang: Lang;
    bindSecret: string;
    ua: string;
    ip: string;
  }): Promise<{ request: LoginRequest; token: string; deepLink: string }> {
    const bindHash = sha256(input.bindSecret);

    // "Starting again for the same browser cancels the previous request."
    const previousId = await this.redis.client.get(this.browserKey(bindHash));
    if (previousId) await this.setStatus(previousId, 'CANCELLED');

    const id = newRequestId();
    const token = randomToken(32);
    const tokenHash = sha256(token);
    const now = Date.now();
    const expiresAt = now + LIMITS.requestTtlSec * 1000;

    const request: LoginRequest = {
      id,
      phone: input.phone,
      lang: input.lang,
      tokenHash,
      bindHash,
      status: 'PENDING',
      tgUserId: null,
      chatId: null,
      codeExpiresAt: null,
      attempts: 0,
      codesIssued: 0,
      lastCodeAt: null,
      firstName: null,
      lastName: null,
      ua: input.ua,
      ip: input.ip,
      createdAt: now,
      expiresAt,
    };

    await this.redis.client
      .multi()
      .hset(this.reqKey(id), this.serialize(request))
      .expire(this.reqKey(id), LIMITS.requestTtlSec)
      .set(this.tokKey(tokenHash), id, 'EX', LIMITS.requestTtlSec)
      .set(this.browserKey(bindHash), id, 'EX', LIMITS.requestTtlSec)
      .exec();

    const deepLink = `https://t.me/${this.config.telegram.username}?start=${token}`;
    return { request, token, deepLink };
  }

  // ---------------------------------------------------------------- reads

  async find(id: string): Promise<LoginRequest | null> {
    const raw = await this.redis.client.hgetall(this.reqKey(id));
    if (!raw || Object.keys(raw).length === 0) return null;
    return this.deserialize(id, raw);
  }

  async findByToken(tokenHash: string): Promise<LoginRequest | null> {
    const id = await this.redis.client.get(this.tokKey(tokenHash));
    return id ? this.find(id) : null;
  }

  /** Latest request this Telegram account is linked to. */
  async findByTelegramUser(tgUserId: number): Promise<LoginRequest | null> {
    const id = await this.redis.client.get(this.tgKey(tgUserId));
    return id ? this.find(id) : null;
  }

  // ---------------------------------------------------------------- writes

  async setStatus(id: string, status: LoginStatus): Promise<void> {
    const key = this.reqKey(id);
    if (!(await this.redis.client.exists(key))) return;
    await this.redis.client.hset(key, 'status', status);
  }

  /**
   * First `/start <token>` binds the request to one Telegram account.
   * Returns false when another account already claimed the token.
   */
  async linkTelegram(request: LoginRequest, tgUserId: number, chatId: number): Promise<boolean> {
    if (request.tgUserId !== null && request.tgUserId !== tgUserId) return false;

    const ttl = Math.max(1, Math.ceil((request.expiresAt - Date.now()) / 1000));
    await this.redis.client
      .multi()
      .hset(this.reqKey(request.id), {
        tgUserId: String(tgUserId),
        chatId: String(chatId),
        status: request.status === 'PENDING' ? 'TG_LINKED' : request.status,
      })
      .set(this.tgKey(tgUserId), request.id, 'EX', ttl)
      .exec();
    return true;
  }

  async setContactName(id: string, firstName: string, lastName: string): Promise<void> {
    await this.redis.client.hset(this.reqKey(id), {
      firstName: firstName ?? '',
      lastName: lastName ?? '',
    });
  }

  /** Generates a code, stores only its HMAC, and enforces cooldown + max codes. */
  async issueCode(id: string): Promise<IssueCodeResult> {
    const code = this.otp.generate();
    const now = Date.now();
    const codeExpiresAt = now + LIMITS.codeTtlSec * 1000;

    const result = (await this.redis.client.evalsha(
      this.issueCodeSha,
      1,
      this.reqKey(id),
      this.otp.hash(id, code),
      String(now),
      String(codeExpiresAt),
      String(LIMITS.maxCodes),
      String(LIMITS.newCodeCooldownSec * 1000),
    )) as LuaResult;

    switch (result[0]) {
      case 'OK':
        return { ok: true, code, codeExpiresAt, codesLeft: Number(result[1]) };
      case 'COOLDOWN':
        return { ok: false, reason: 'COOLDOWN', retryAfter: Number(result[1]) };
      case 'BAD_STATUS':
        return { ok: false, reason: 'BAD_STATUS', status: result[1] };
      case 'MAX_CODES':
        return { ok: false, reason: 'MAX_CODES' };
      default:
        return { ok: false, reason: 'NOT_FOUND' };
    }
  }

  /** Counts the attempt atomically, then returns the digest for a timing-safe compare. */
  async verifyBegin(id: string, bindSecret: string): Promise<VerifyBeginResult> {
    const result = (await this.redis.client.evalsha(
      this.verifyBeginSha,
      1,
      this.reqKey(id),
      String(Date.now()),
      sha256(bindSecret),
      String(LIMITS.maxAttempts),
    )) as LuaResult;

    if (result[0] === 'OK') {
      return { ok: true, codeHash: result[1], attemptsLeft: Number(result[2]) };
    }
    return { ok: false, reason: result[0] as Exclude<VerifyBeginResult, { ok: true }>['reason'] };
  }

  /** Called after a successful timing-safe compare. */
  async markVerified(id: string): Promise<void> {
    await this.redis.client.hset(this.reqKey(id), 'status', 'VERIFIED');
  }

  async markLocked(id: string): Promise<void> {
    await this.redis.client.hset(this.reqKey(id), 'status', 'LOCKED');
  }

  async drop(id: string): Promise<void> {
    const request = await this.find(id);
    if (!request) return;
    const pipeline = this.redis.client.multi().del(this.reqKey(id), this.tokKey(request.tokenHash));
    if (request.tgUserId !== null) pipeline.del(this.tgKey(request.tgUserId));
    await pipeline.exec();
  }

  // ---------------------------------------------------------------- helpers

  /** A request whose hash has expired is reported as EXPIRED, not "not found". */
  effectiveStatus(request: LoginRequest | null): LoginStatus {
    if (!request) return 'EXPIRED';
    if (TERMINAL_STATUSES.includes(request.status)) return request.status;
    if (request.expiresAt <= Date.now()) return 'EXPIRED';
    return request.status;
  }

  private serialize(r: LoginRequest): Record<string, string> {
    return {
      phone: r.phone,
      lang: r.lang,
      tokenHash: r.tokenHash,
      bindHash: r.bindHash,
      status: r.status,
      tgUserId: r.tgUserId === null ? '' : String(r.tgUserId),
      chatId: r.chatId === null ? '' : String(r.chatId),
      codeHash: '',
      codeExpiresAt: '',
      attempts: '0',
      codesIssued: '0',
      lastCodeAt: '',
      firstName: '',
      lastName: '',
      ua: r.ua,
      ip: r.ip,
      createdAt: String(r.createdAt),
      expiresAt: String(r.expiresAt),
    };
  }

  private deserialize(id: string, raw: Record<string, string>): LoginRequest {
    const num = (v: string | undefined): number | null =>
      v === undefined || v === '' ? null : Number(v);
    return {
      id,
      phone: raw.phone,
      lang: (raw.lang as Lang) ?? 'uz',
      tokenHash: raw.tokenHash,
      bindHash: raw.bindHash,
      status: raw.status as LoginStatus,
      tgUserId: num(raw.tgUserId),
      chatId: num(raw.chatId),
      codeExpiresAt: num(raw.codeExpiresAt),
      attempts: num(raw.attempts) ?? 0,
      codesIssued: num(raw.codesIssued) ?? 0,
      lastCodeAt: num(raw.lastCodeAt),
      firstName: raw.firstName || null,
      lastName: raw.lastName || null,
      ua: raw.ua ?? '',
      ip: raw.ip ?? '',
      createdAt: num(raw.createdAt) ?? 0,
      expiresAt: num(raw.expiresAt) ?? 0,
    };
  }
}
