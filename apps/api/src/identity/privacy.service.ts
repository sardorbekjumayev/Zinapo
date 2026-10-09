import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { AuditService } from '../common/audit.service';
import { ActorService, Actor } from '../authz';
import { NotifyService } from '../notify/notify.service';
import { FamilyNotifier } from './family-notifier.service';
import { caseReference } from './children.service';
import { AnonymisationPendingException } from './identity.errors';

/**
 * How long a request waits before the job executes it. The owner can cancel
 * until then (design/06: "Until then you can cancel the request"). Decided with
 * the product owner, note M2-b; override with ANONYMISATION_GRACE_DAYS.
 */
const GRACE_DAYS = Number(process.env.ANONYMISATION_GRACE_DAYS ?? 7);

/** The job looks for due requests this often. Execution is not time-critical. */
const TICK_MS = 10 * 60_000;

export interface AnonymisationView {
  id: string;
  reference: string;
  requestedAt: string;
  /** The job runs it after this moment; cancellable until then. */
  executeAfter: string;
}

/**
 * task.md § 6 (`privacy`) and rule 13: deletion = anonymisation. The owner
 * requests, the request waits out its grace window, then this job runs
 * `zn_anonymise_child` — identifiers and relationships go, responses stay
 * (INV-16). A `super_admin` can run a request immediately (§ 3,
 * "`super_admin` executes").
 *
 * Like the notification dispatcher, a plain interval rather than BullMQ: the
 * request table is the durable queue and execution is one SQL function call.
 */
@Injectable()
export class PrivacyService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrivacyService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly actors: ActorService,
    private readonly notify: NotifyService,
    private readonly family: FamilyNotifier,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async current(childId: string): Promise<AnonymisationView | null> {
    const row = await this.db.one<{ id: string; requested_at: Date }>(
      `SELECT id, requested_at FROM anonymisation_request
        WHERE child_id = $1 AND executed_at IS NULL AND cancelled_at IS NULL`,
      [childId],
    );
    return row ? toView(row) : null;
  }

  /** Idempotent: asking twice returns the request already waiting. */
  async request(actor: Actor, childId: string, reason?: string): Promise<AnonymisationView> {
    const existing = await this.current(childId);
    if (existing) return existing;

    const row = await this.db.one<{ id: string; requested_at: Date }>(
      `INSERT INTO anonymisation_request (child_id, requested_by, reason)
       VALUES ($1, $2, $3)
       RETURNING id, requested_at`,
      [childId, actor.personId, reason?.trim() || null],
    );
    const view = toView(row!);

    await this.audit.write({
      action: 'privacy.anonymisation_requested',
      personId: actor.personId,
      payload: { childId, requestId: view.id, executeAfter: view.executeAfter },
    });
    await this.family.guardians(childId, 'anonymisation_requested', {
      child: await this.family.childName(childId),
      executeAfter: view.executeAfter,
      link: `${this.config.webOrigin}/uz/family/privacy`,
    });
    return view;
  }

  async cancel(actor: Actor, childId: string): Promise<void> {
    const row = await this.db.one<{ id: string }>(
      `UPDATE anonymisation_request SET cancelled_at = now()
        WHERE child_id = $1 AND executed_at IS NULL AND cancelled_at IS NULL
        RETURNING id`,
      [childId],
    );
    if (!row) throw new NotFoundException({ error: 'NOT_FOUND' });

    await this.audit.write({
      action: 'privacy.anonymisation_cancelled',
      personId: actor.personId,
      payload: { childId, requestId: row.id },
    });
    await this.family.guardians(childId, 'anonymisation_cancelled', {
      child: await this.family.childName(childId),
    });
  }

  /** Refuses changes to a child whose deletion is under way. */
  async assertNotPending(childId: string): Promise<void> {
    if (await this.current(childId)) throw new AnonymisationPendingException();
  }

  /** `POST /staff/anonymisation-requests/:id/execute` — super_admin only. */
  async executeNow(actor: Actor, requestId: string): Promise<{ childId: string }> {
    const childId = await this.execute(requestId, actor.personId);
    if (!childId) throw new NotFoundException({ error: 'NOT_FOUND' });
    return { childId };
  }

  /** Exposed so a test can drain due requests without waiting ten minutes. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.db.query<{ id: string }>(
        `SELECT id FROM anonymisation_request
          WHERE executed_at IS NULL AND cancelled_at IS NULL
            AND requested_at <= now() - make_interval(days => $1)
          ORDER BY requested_at
          LIMIT 50`,
        [GRACE_DAYS],
      );
      let done = 0;
      for (const row of due) {
        if (await this.execute(row.id, null)) done += 1;
      }
      if (done) this.logger.log(`anonymised ${done} child profile(s)`);
      return done;
    } catch (err) {
      this.logger.error('anonymisation tick failed', err as Error);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /**
   * Runs one request. Returns the child id, or null when the request was not
   * open (cancelled in the meantime, or already executed by another instance).
   */
  private async execute(requestId: string, executedBy: string | null): Promise<string | null> {
    // Who to tell, and who loses access, must be read BEFORE the function
    // revokes every relationship.
    const before = await this.db.one<{
      child_id: string;
      requested_by: string;
      name: string;
      people: string[];
    }>(
      `SELECT ar.child_id, ar.requested_by,
              c.given_name || ' ' || c.family_name AS name,
              ARRAY(SELECT g.person_id::text FROM guardianship g
                     WHERE g.child_id = ar.child_id AND g.revoked_at IS NULL
                    UNION
                    SELECT el.educator_person_id::text FROM educator_link el
                     WHERE el.child_id = ar.child_id
                       AND el.status IN ('requested','active','suspended')) AS people
         FROM anonymisation_request ar JOIN child c ON c.id = ar.child_id
        WHERE ar.id = $1 AND ar.executed_at IS NULL AND ar.cancelled_at IS NULL`,
      [requestId],
    );
    if (!before) return null;

    try {
      await this.db.transaction(async (client) => {
        await client.query(`SELECT zn_anonymise_child($1, $2)`, [requestId, executedBy]);
        await this.notify.queue(
          { personId: before.requested_by, template: 'anonymisation_done', vars: { child: before.name } },
          client,
        );
      });
    } catch (err) {
      // 'no_data_found': cancelled or executed between the read and the call.
      if ((err as { code?: string }).code === 'P0002') return null;
      throw err;
    }

    await this.actors.invalidate(...before.people);
    await this.audit.write({
      action: 'privacy.anonymisation_executed',
      personId: executedBy,
      // No name: this row outlives the identifiers it would otherwise preserve.
      payload: { childId: before.child_id, requestId, by: executedBy ? 'super_admin' : 'job' },
    });
    return before.child_id;
  }
}

function toView(row: { id: string; requested_at: Date }): AnonymisationView {
  const requestedAt = new Date(row.requested_at);
  return {
    id: row.id,
    reference: caseReference('DEL', row.id),
    requestedAt: requestedAt.toISOString(),
    executeAfter: new Date(requestedAt.getTime() + GRACE_DAYS * 86_400_000).toISOString(),
  };
}
