import { Controller, Inject, NotFoundException, Post } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/configuration';
import { SeedService, SeedResult } from './seed.service';
import { SeedBankService } from './seed-bank.service';
import { SessionsService } from '../sessions/sessions.service';

/**
 * `POST /api/dev/seed` — the M1 development fixture (task.md § 12).
 *
 * It lives behind the same development guard as the Telegram simulator: it
 * returns real person ids and real phone numbers, so it 404s outside
 * development and the whole DevModule is not even registered in production.
 *
 * Driven by `./scripts/seed.sh`.
 */
@Controller('dev')
export class SeedController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly seed: SeedService,
    private readonly seedBank: SeedBankService,
    private readonly sessions: SessionsService,
  ) {}

  @Post('seed')
  async run(): Promise<SeedResult> {
    if (this.config.isProd) throw new NotFoundException();
    return this.seed.run();
  }

  /** `POST /api/dev/seed-bank` — the M3 grade 4 item bank. Needs `/dev/seed` first. */
  @Post('seed-bank')
  async bank() {
    if (this.config.isProd) throw new NotFoundException();
    return this.seedBank.run();
  }

  /** `POST /api/dev/tick` — run the sessions/wave job now instead of within a minute. */
  @Post('tick')
  async tick() {
    if (this.config.isProd) throw new NotFoundException();
    return this.sessions.tick();
  }
}
