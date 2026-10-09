import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { ActorService, Actor } from '../authz';
import { NotifyService } from '../notify/notify.service';
import { FamilyNotifier } from './family-notifier.service';
import { SeasonLookup } from './season.lookup';
import { LinkStateException, ValidUntilInvalidException } from './identity.errors';

/** task.md § 8.4.2: an educator's access request lives 14 days. */
export const REQUEST_TTL_DAYS = 14;

export type LinkStatus = 'requested' | 'active' | 'declined' | 'revoked' | 'suspended' | 'expired';

export interface EducatorAccessView {
  linkId: string;
  educatorName: string;
  educatorKind: 'tutor' | 'school_teacher' | 'learning_centre';
  publicCode: string;
  /**
   * What the owner sees, which is not quite the column: a request older than
   * 14 days reads `expired`, and an active link past `valid_until` too.
   */
  status: LinkStatus;
  requestedAt: string;
  /** For a request: when it lapses on its own. */
  requestExpiresAt: string | null;
  validUntil: string;
  decidedAt: string | null;
  revokedAt: string | null;
  /** A switched-off link can be switched back on until its end date. */
  canRestore: boolean;
}

export interface UntilOptions {
  /** "End of the school year" — 31 May, recommended (design/06). */
  schoolYearEnd: string;
  /** "For 3 months". */
  threeMonths: string;
  /** The latest date any access may run to: the end of the season. */
  max: string;
}

/**
 * The family side of `educator_link` (task.md § 8.1.5): approve with an expiry,
 * decline (which blocks that educator for the season), switch off, restore.
 * Only the owner decides (§ 3, "Grant / revoke educator access").
 *
 * The educator side — requests, match-checks, invites — is M6 (`access`). Both
 * write the same rows; neither ever authorises through `group_member` (INV-15).
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly actors: ActorService,
    private readonly notify: NotifyService,
    private readonly family: FamilyNotifier,
    private readonly seasons: SeasonLookup,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async forChild(childId: string): Promise<{ links: EducatorAccessView[]; until: UntilOptions }> {
    const rows = await this.db.query<{
      id: string;
      educator_name: string;
      kind: EducatorAccessView['educatorKind'];
      public_code: string;
      status: LinkStatus;
      requested_at: string;
      valid_until: string;
      decided_at: string | null;
      revoked_at: string | null;
      request_lapsed: boolean;
      window_over: boolean;
      season_over: boolean;
      newer_live: boolean;
    }>(
      `SELECT el.id,
              p.full_name AS educator_name,
              ep.kind,
              ep.public_code,
              el.status,
              el.requested_at,
              el.valid_until,
              el.decided_at,
              el.revoked_at,
              (el.requested_at < now() - make_interval(days => $2)) AS request_lapsed,
              (el.valid_until <= now())                              AS window_over,
              (el.season_id IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM season s WHERE s.id = el.season_id AND s.is_current)) AS season_over,
              EXISTS (SELECT 1 FROM educator_link o
                       WHERE o.child_id = el.child_id
                         AND o.educator_person_id = el.educator_person_id
                         AND o.id <> el.id
                         AND o.status IN ('requested','active','suspended')) AS newer_live
         FROM educator_link el
         JOIN educator_profile ep ON ep.person_id = el.educator_person_id
         JOIN person p ON p.id = el.educator_person_id
        WHERE el.child_id = $1
        ORDER BY el.requested_at DESC`,
      [childId, REQUEST_TTL_DAYS],
    );

    const links = rows
      // A declined row is the season's block, kept for audit; the owner saw
      // the decision when they made it. An old season's rows are history.
      .filter((r) => r.status !== 'declined' && !r.season_over)
      .map((r): EducatorAccessView => {
        let status: LinkStatus = r.status;
        if (status === 'requested' && r.request_lapsed) status = 'expired';
        if ((status === 'active' || status === 'suspended') && r.window_over) status = 'expired';
        return {
          linkId: r.id,
          educatorName: r.educator_name,
          educatorKind: r.kind,
          publicCode: r.public_code,
          status,
          requestedAt: r.requested_at,
          requestExpiresAt:
            r.status === 'requested'
              ? new Date(new Date(r.requested_at).getTime() + REQUEST_TTL_DAYS * 86_400_000)
                  .toISOString()
              : null,
          validUntil: r.valid_until,
          decidedAt: r.decided_at,
          revokedAt: r.revoked_at,
          canRestore: r.status === 'revoked' && !r.window_over && !r.newer_live,
        };
      })
      .filter((l) => l.status !== 'expired' || l.decidedAt !== null);

    return { links, until: await this.untilOptions() };
  }

  /** The choices on the approve card, computed once so client and server agree. */
  async untilOptions(): Promise<UntilOptions> {
    const season = await this.seasons.current();
    const today = new Date();
    const three = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 3, today.getUTCDate()));
    const max = season?.endsOn ?? isoDate(new Date(today.getTime() + 365 * 86_400_000));
    const threeIso = isoDate(three);
    return {
      schoolYearEnd: season?.schoolYearEnd ?? max,
      threeMonths: threeIso < max ? threeIso : max,
      max,
    };
  }

  /**
   * Approve a request. INV-05: access always expires — the owner picks the
   * end date, bounded by the season, and the link closes by itself.
   */
  async approve(actor: Actor, linkId: string, validUntil: string): Promise<EducatorAccessView> {
    const until = await this.untilOptions();
    const day = validUntil.slice(0, 10);
    if (day <= isoDate(new Date()) || day > until.max) throw new ValidUntilInvalidException();

    const link = await this.ownedLink(actor, linkId);
    if (link.status !== 'requested' || link.request_lapsed) throw new LinkStateException('not_requested');

    const season = await this.seasons.current();
    await this.db.query(
      `UPDATE educator_link
          SET status = 'active',
              valid_from = now(),
              -- the whole of the chosen day, Tashkent time
              valid_until = ($2::date + interval '1 day' - interval '1 second')
                            AT TIME ZONE 'Asia/Tashkent',
              decided_by = $3,
              decided_at = now(),
              season_id = COALESCE(season_id, $4)
        WHERE id = $1`,
      [linkId, day, actor.personId, season?.id ?? null],
    );

    await this.afterChange(actor, link, 'access.granted', { validUntil: day });
    const child = await this.family.childName(link.child_id);
    const educator = await this.family.personName(link.educator_person_id);
    await this.family.guardians(link.child_id, 'access_granted', { child, educator, until: day });
    await this.notify.queue({
      personId: link.educator_person_id,
      template: 'educator_access_granted',
      vars: { child, until: day, link: `${this.config.webOrigin}/uz/educator` },
    });
    return this.view(link.child_id, linkId);
  }

  /**
   * Decline: "blocks for the season" (task.md § 8.1.5). The row keeps status
   * `declined` and its `season_id`; M6's request endpoint refuses a new
   * request for the same pair while that season is current. The educator is
   * not messaged — design/06: they see only "request not accepted".
   */
  async decline(actor: Actor, linkId: string): Promise<void> {
    const link = await this.ownedLink(actor, linkId);
    if (link.status !== 'requested') throw new LinkStateException('not_requested');

    const season = await this.seasons.current();
    await this.db.query(
      `UPDATE educator_link
          SET status = 'declined', decided_by = $2, decided_at = now(),
              season_id = COALESCE(season_id, $3)
        WHERE id = $1`,
      [linkId, actor.personId, season?.id ?? null],
    );
    await this.afterChange(actor, link, 'access.declined', {});
  }

  /** "Switch off" — the child's history stays with the child (design/06). */
  async revoke(actor: Actor, childId: string, linkId: string): Promise<EducatorAccessView> {
    const link = await this.ownedLink(actor, linkId, childId);
    if (link.status !== 'active' && link.status !== 'suspended') {
      throw new LinkStateException('not_active');
    }

    await this.db.query(
      `UPDATE educator_link SET status = 'revoked', revoked_at = now() WHERE id = $1`,
      [linkId],
    );
    await this.afterChange(actor, link, 'access.revoked', {});

    const child = await this.family.childName(link.child_id);
    const educator = await this.family.personName(link.educator_person_id);
    await this.family.guardians(link.child_id, 'access_revoked', { child, educator });
    await this.notify.queue({
      personId: link.educator_person_id,
      template: 'educator_access_ended',
      vars: { child },
    });
    return this.view(link.child_id, linkId);
  }

  /**
   * "Restore" — undo a switch-off, back to the same end date. Not possible
   * once the end date has passed (that is a new request, M6) or if the pair
   * already has a newer live link.
   */
  async restore(actor: Actor, childId: string, linkId: string): Promise<EducatorAccessView> {
    const link = await this.ownedLink(actor, linkId, childId);
    if (link.status !== 'revoked') throw new LinkStateException('not_revoked');
    if (link.window_over) throw new LinkStateException('expired');

    try {
      await this.db.query(
        `UPDATE educator_link
            SET status = 'active', revoked_at = NULL, decided_by = $2, decided_at = now()
          WHERE id = $1`,
        [linkId, actor.personId],
      );
    } catch (err) {
      // educator_link_one_live: a newer request or link exists for the pair.
      if ((err as { code?: string }).code === '23505') throw new LinkStateException('conflict');
      throw err;
    }
    await this.afterChange(actor, link, 'access.restored', { validUntil: link.valid_until });

    const child = await this.family.childName(link.child_id);
    const educator = await this.family.personName(link.educator_person_id);
    await this.family.guardians(link.child_id, 'access_granted', {
      child,
      educator,
      until: link.valid_until,
    });
    await this.notify.queue({
      personId: link.educator_person_id,
      template: 'educator_access_granted',
      vars: { child, until: link.valid_until, link: `${this.config.webOrigin}/uz/educator` },
    });
    return this.view(link.child_id, linkId);
  }

  // ------------------------------------------------------------ helpers

  /**
   * The link, if the actor OWNS its child. Anything else is a 404 — a link id
   * must not confirm to a stranger that a child exists (task.md § 4).
   */
  private async ownedLink(actor: Actor, linkId: string, childId?: string) {
    if (!UUID.test(linkId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const row = await this.db.one<{
      id: string;
      child_id: string;
      educator_person_id: string;
      status: LinkStatus;
      valid_until: string;
      request_lapsed: boolean;
      window_over: boolean;
    }>(
      `SELECT el.id, el.child_id, el.educator_person_id, el.status,
              to_char(el.valid_until AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS valid_until,
              (el.requested_at < now() - make_interval(days => $3)) AS request_lapsed,
              (el.valid_until <= now()) AS window_over
         FROM educator_link el
         JOIN guardianship g
           ON g.child_id = el.child_id AND g.person_id = $2
          AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE el.id = $1 AND ($4::uuid IS NULL OR el.child_id = $4::uuid)`,
      [linkId, actor.personId, REQUEST_TTL_DAYS, childId ?? null],
    );
    if (!row) throw new NotFoundException({ error: 'NOT_FOUND' });
    return row;
  }

  private async afterChange(
    actor: Actor,
    link: { id: string; child_id: string; educator_person_id: string },
    action: 'access.granted' | 'access.declined' | 'access.revoked' | 'access.restored',
    extra: Record<string, unknown>,
  ): Promise<void> {
    // The educator's `activeChildren` count and visible set just changed.
    await this.actors.invalidate(link.educator_person_id);
    await this.audit.write({
      action,
      personId: actor.personId,
      payload: {
        childId: link.child_id,
        linkId: link.id,
        educatorPersonId: link.educator_person_id,
        ...extra,
      },
    });
  }

  private async view(childId: string, linkId: string): Promise<EducatorAccessView> {
    const { links } = await this.forChild(childId);
    const found = links.find((l) => l.linkId === linkId);
    if (!found) throw new NotFoundException({ error: 'NOT_FOUND' });
    return found;
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
