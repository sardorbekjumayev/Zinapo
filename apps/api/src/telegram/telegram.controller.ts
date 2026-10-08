import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Update } from 'telegraf/types';
import { AppConfig, CONFIG } from '../config/configuration';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly telegram: TelegramService,
  ) {}

  /**
   * signin.md § 3.8 — reject any update whose secret-token header does not
   * match. The endpoint answers 200 either way only after the check passes.
   */
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Body() update: Update,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
  ): Promise<{ ok: true }> {
    if (!this.config.telegram.webhookSecret || secret !== this.config.telegram.webhookSecret) {
      throw new UnauthorizedException();
    }
    await this.telegram.handleUpdate(update);
    return { ok: true };
  }
}
