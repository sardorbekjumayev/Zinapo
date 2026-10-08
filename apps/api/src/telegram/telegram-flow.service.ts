import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { sha256 } from '../common/crypto.util';
import { maskPhone, toE164 } from '../common/phone.util';
import { LoginRequestService } from '../auth/login-request.service';
import { Lang } from '../auth/login-request.types';
import { describeUa, hhmm, t } from './bot-texts';

export interface BotReply {
  text: string;
  /** reply keyboard to attach */
  keyboard?: 'contact' | 'remove';
  /** inline buttons under the code message */
  inline?: boolean;
  markdown?: boolean;
  /** label for the contact-request button, when keyboard === 'contact' */
  contactLabel?: string;
  /** language for inline button labels */
  lang?: Lang;
}

export interface Contact {
  userId: number | undefined;
  phoneNumber: string;
  firstName: string;
  lastName?: string;
}

/**
 * All bot-side decisions live here, independent of Telegraf. The webhook
 * handler and the dev simulator both drive the same code paths.
 */
@Injectable()
export class TelegramFlowService {
  private readonly logger = new Logger(TelegramFlowService.name);

  constructor(
    private readonly login: LoginRequestService,
    private readonly audit: AuditService,
  ) {}

  /** `/start <token>` — binds the request to exactly one Telegram account. */
  async onStart(token: string | undefined, tgUserId: number, chatId: number): Promise<BotReply[]> {
    if (!token) return [{ text: t(undefined, 'greeting') }];

    const request = await this.login.findByToken(sha256(token));
    const status = this.login.effectiveStatus(request);

    if (!request || status === 'EXPIRED' || status === 'CANCELLED') {
      return [{ text: t(request?.lang, 'linkExpired') }];
    }
    if (request.tgUserId !== null && request.tgUserId !== tgUserId) {
      return [{ text: t(request.lang, 'linkUsed') }];
    }

    const linked = await this.login.linkTelegram(request, tgUserId, chatId);
    if (!linked) return [{ text: t(request.lang, 'linkUsed') }];

    await this.audit.write({
      action: 'auth.tg_linked',
      payload: { requestId: request.id, tgUserId },
    });

    return [
      {
        text: t(request.lang, 'askPhone'),
        keyboard: 'contact',
        contactLabel: t(request.lang, 'sharePhoneBtn'),
      },
    ];
  }

  /** A shared contact: must be the sender's own, and must match the typed number. */
  async onContact(tgUserId: number, contact: Contact): Promise<BotReply[]> {
    const request = await this.login.findByTelegramUser(tgUserId);
    if (!request) return [{ text: t(undefined, 'startFromSite'), keyboard: 'remove' }];

    const status = this.login.effectiveStatus(request);
    if (status === 'EXPIRED' || status === 'CANCELLED') {
      return [{ text: t(request.lang, 'linkExpired'), keyboard: 'remove' }];
    }

    // Forwarded contacts and other people's cards carry a different user_id.
    if (contact.userId !== tgUserId) {
      return [{ text: t(request.lang, 'ownNumberOnly') }];
    }

    const shared = toE164(contact.phoneNumber);
    if (!shared || shared !== request.phone) {
      await this.login.setStatus(request.id, 'PHONE_MISMATCH');
      await this.audit.write({
        action: 'auth.phone_mismatch',
        payload: {
          requestId: request.id,
          expected: maskPhone(request.phone),
          got: shared ? maskPhone(shared) : 'invalid',
        },
      });
      return [{ text: t(request.lang, 'phoneMismatch'), keyboard: 'remove' }];
    }

    await this.login.setContactName(request.id, contact.firstName, contact.lastName ?? '');
    return [
      { text: t(request.lang, 'removeKb'), keyboard: 'remove' },
      ...(await this.sendCode(request.id, request.lang)),
    ];
  }

  /** "Yangi kod" button. */
  async onNewCode(tgUserId: number): Promise<BotReply[]> {
    const request = await this.login.findByTelegramUser(tgUserId);
    if (!request) return [{ text: t(undefined, 'noActiveRequest') }];

    const status = this.login.effectiveStatus(request);
    if (status !== 'CODE_SENT' && status !== 'TG_LINKED') {
      return [{ text: t(request.lang, 'noActiveRequest') }];
    }
    return this.sendCode(request.id, request.lang);
  }

  /** "Bu men emasman" button. */
  async onNotMe(tgUserId: number): Promise<BotReply[]> {
    const request = await this.login.findByTelegramUser(tgUserId);
    if (!request) return [{ text: t(undefined, 'noActiveRequest') }];

    await this.login.setStatus(request.id, 'CANCELLED');
    await this.audit.write({ action: 'auth.cancelled', payload: { requestId: request.id } });
    return [{ text: t(request.lang, 'cancelled'), keyboard: 'remove' }];
  }

  private async sendCode(requestId: string, lang: Lang): Promise<BotReply[]> {
    const issued = await this.login.issueCode(requestId);

    if (!issued.ok) {
      if (issued.reason === 'COOLDOWN') {
        return [{ text: t(lang, 'cooldown', { n: issued.retryAfter }) }];
      }
      if (issued.reason === 'MAX_CODES') return [{ text: t(lang, 'maxCodes') }];
      return [{ text: t(lang, 'linkExpired') }];
    }

    const request = await this.login.find(requestId);
    await this.audit.write({
      action: 'auth.code_issued',
      payload: { requestId, codesLeft: issued.codesLeft },
    });
    this.logger.log(`code issued for ${requestId} (codesLeft=${issued.codesLeft})`);

    return [
      {
        text: t(lang, 'code', {
          code: issued.code,
          ua: describeUa(request?.ua ?? ''),
          time: hhmm(request?.createdAt ?? Date.now()),
        }),
        inline: true,
        markdown: true,
        lang,
      },
    ];
  }

  labels(lang: Lang): { newCode: string; notMe: string } {
    return { newCode: t(lang, 'newCodeBtn'), notMe: t(lang, 'notMeBtn') };
  }
}
