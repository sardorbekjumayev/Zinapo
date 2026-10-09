import { Controller, Inject, NotFoundException, Post } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/configuration';
import { SeedService, SeedResult } from './seed.service';
import { SeedBankService } from './seed-bank.service';
import { SeedResultsService } from './seed-results.service';
import { SessionsService } from '../sessions/sessions.service';
import { MeasurementService } from '../measurement/measurement.service';
import { RedisService } from '../redis/redis.service';
import { InvitesService } from '../educator/invites.service';
import { SeedEducatorService } from './seed-educator.service';
import { SeedOlympiadService } from './seed-olympiad.service';

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
    private readonly seedResults: SeedResultsService,
    private readonly sessions: SessionsService,
    private readonly measurement: MeasurementService,
    private readonly seedEducator: SeedEducatorService,
    private readonly seedOlympiad: SeedOlympiadService,
    private readonly invites: InvitesService,
    private readonly redis: RedisService,
  ) {}

  @Post('seed')
  async run(): Promise<SeedResult> {
    if (this.config.isProd) throw new NotFoundException();
    // The match-check's daily limit and miss counters (M6): a test suite that
    // runs many times a day would otherwise lock the seeded educators out.
    const stale = await this.redis.client.keys('zn:mc:*');
    if (stale.length) await this.redis.client.del(...stale);
    return this.seed.run();
  }

  /** `POST /api/dev/seed-bank` — the M3 grade 4 item bank. Needs `/dev/seed` first. */
  @Post('seed-bank')
  async bank() {
    if (this.config.isProd) throw new NotFoundException();
    return this.seedBank.run();
  }

  /** `POST /api/dev/seed-results` — M5: measured history for the reports. Needs seed + seed-bank. */
  @Post('seed-results')
  async results() {
    if (this.config.isProd) throw new NotFoundException();
    return this.seedResults.run();
  }

  /** `POST /api/dev/seed-educator` — M6: Aziza's groups, invitations, practice. Needs the three above. */
  @Post('seed-educator')
  async educator() {
    if (this.config.isProd) throw new NotFoundException();
    return this.seedEducator.run();
  }

  /** `POST /api/dev/seed-olympiad` — M7: olympiads with a stage in every state. Needs seed, seed-bank, seed-results. */
  @Post('seed-olympiad')
  async olympiad() {
    if (this.config.isProd) throw new NotFoundException();
    return this.seedOlympiad.run();
  }

  /** `POST /api/dev/tick` — run the sessions/wave job, the measurement job and the access-request expiry now. */
  @Post('tick')
  async tick() {
    if (this.config.isProd) throw new NotFoundException();
    const sessions = await this.sessions.tick();
    const runs = await this.measurement.tick();
    const expiredRequests = await this.invites.expireLapsedRequests();
    return { ...sessions, runs, expiredRequests };
  }
}
