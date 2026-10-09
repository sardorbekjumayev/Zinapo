import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { maskPhone, maskPhoneForDisplay, toE164 } from '../common/phone.util';
import { randomToken } from '../common/crypto.util';
import { AppConfig, CONFIG } from '../config/configuration';
import { ActorService, Actor } from '../authz';
import { NotifyService } from '../notify/notify.service';
import { FamilyNotifier } from './family-notifier.service';
import {
  AlreadyGuardianException,
  InviteInvalidException,
  NotACoGuardianException,
  PhoneInvalidException,
  TransferPendingException,
} from './identity.errors';

/** An invitation is a link sent by SMS or Telegram; a week is enough to act on it. */
const INVITE_TTL_DAYS = 7;

export type InviteKind = 'co_guardian' | 'ownership_transfer';

export interface GuardianView {
  personId: string;
  fullName: string;
  role: 'owner' | 'co_guardian';
  isMe: boolean;
  since: string;
}

export interface PendingInviteView {
  id: string;
  kind: InviteKind;
  /** Masked: the owner typed it, but a screenshot should not carry it. */
  phone: string;
  /** Set when the number already belongs to a person on Zinapo. */
  inviteeName: string | null;
  expiresAt: string;
  /** When it was last sent — a re-send refreshes the week. */
  sentAt: string;
}

export interface IncomingInviteView {
  code: string;
  kind: InviteKind;
  childName: string;
  childGrade: number | null;
  inviterName: string;
  expiresAt: string;
}

interface InviteRow {
  id: string;
  child_id: string;
  invited_by: string;
  phone_e164: string;
  kind: InviteKind;
  expires_at: string;
  accepted_at: string | null;
  cancelled_at: string | null;
}

/**
 * task.md § 6 (`identity`: guardianship, co-guardian invites, ownership
 * transfer) and § 8.1.5 / § 8.2.
 *
 * INV-03 and INV-04 shape everything here: there is always exactly one live
 * owner, so an ownership transfer is an offer that the co-guardian must
 * accept, and the swap happens in ONE transaction (the owner check is
 * deferred to COMMIT).
 */
@Injectable()
export class GuardiansService {
  private readonly logger = new Logger(GuardiansService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly actors: ActorService,
    private readonly notify: NotifyService,
    private readonly family: FamilyNotifier,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  // ---------------------------------------------------------------- reads

  /** The people who can see this child, plus the invitations still open. */
  async forChild(
    actor: Actor,
    childId: string,
  ): Promise<{ guardians: GuardianView[]; pending: PendingInviteView[] }> {
    const guardians = await this.db.query<GuardianView>(
      `SELECT g.person_id   AS "personId",
              p.full_name   AS "fullName",
              g.role::text  AS role,
              (g.person_id = $2) AS "isMe",
              g.granted_at  AS since
         FROM guardianship g
         JOIN person p ON p.id = g.person_id
        WHERE g.child_id = $1 AND g.revoked_at IS NULL
        ORDER BY (g.role = 'owner') DESC, g.granted_at`,
      [childId, actor.personId],
    );

    const invites = await this.db.query<{
      id: string;
      kind: InviteKind;
      phone_e164: string;
      invitee_name: string | null;
      expires_at: string;
    }>(
      `SELECT gi.id, gi.kind, gi.phone_e164, p.full_name AS invitee_name, gi.expires_at
         FROM guardian_invite gi
    LEFT JOIN person p ON p.phone = gi.phone_e164
        WHERE gi.child_id = $1
          AND gi.accepted_at IS NULL
          AND gi.cancelled_at IS NULL
          AND gi.expires_at > now()
        ORDER BY gi.expires_at`,
      [childId],
    );

    return {
      guardians,
      pending: invites.map((i) => ({
        id: i.id,
        kind: i.kind,
        phone: maskPhoneForDisplay(i.phone_e164),
        inviteeName: i.invitee_name,
        expiresAt: i.expires_at,
        sentAt: new Date(new Date(i.expires_at).getTime() - INVITE_TTL_DAYS * 86_400_000)
          .toISOString(),
      })),
    };
  }

  /**
   * Invitations addressed to the caller's own verified phone. Sign-in proved
   * the number (Telegram contact), so a match on phone is a match on person —
   * no code needed to see them, which is how onboarding can offer "accept".
   */
  async incoming(actor: Actor): Promise<IncomingInviteView[]> {
    return this.db.query<IncomingInviteView>(
      `SELECT gi.code,
              gi.kind,
              c.given_name || ' ' || c.family_name AS "childName",
              (SELECT e.grade FROM enrolment e
                WHERE e.child_id = c.id AND e.ended_at IS NULL
                ORDER BY e.school_year DESC LIMIT 1)   AS "childGrade",
              ip.full_name AS "inviterName",
              gi.expires_at AS "expiresAt"
         FROM person me
         JOIN guardian_invite gi ON gi.phone_e164 = me.phone
         JOIN child c ON c.id = gi.child_id
         JOIN person ip ON ip.id = gi.invited_by
        WHERE me.id = $1
          AND gi.accepted_at IS NULL
          AND gi.cancelled_at IS NULL
          AND gi.expires_at > now()
          AND c.anonymised_at IS NULL
        ORDER BY gi.expires_at`,
      [actor.personId],
    );
  }

  /** The invite landing page. Only its addressee may see what it is about. */
  async preview(actor: Actor, code: string): Promise<IncomingInviteView> {
    const invite = await this.loadUsable(actor, code);
    const row = await this.db.one<IncomingInviteView>(
      `SELECT gi.code, gi.kind,
              c.given_name || ' ' || c.family_name AS "childName",
              (SELECT e.grade FROM enrolment e
                WHERE e.child_id = c.id AND e.ended_at IS NULL
                ORDER BY e.school_year DESC LIMIT 1) AS "childGrade",
              ip.full_name AS "inviterName",
              gi.expires_at AS "expiresAt"
         FROM guardian_invite gi
         JOIN child c ON c.id = gi.child_id
         JOIN person ip ON ip.id = gi.invited_by
        WHERE gi.id = $1`,
      [invite.id],
    );
    if (!row) throw new InviteInvalidException('not_found');
    return row;
  }

  // ------------------------------------------------------- co-guardians

  /**
   * task.md § 8.2: "Gets an invite by phone → signs in → accepts".
   *
   * Idempotent per (child, phone): inviting the same number again re-sends the
   * same invitation with a fresh week rather than failing — which is what a
   * parent means when they press the button twice.
   */
  async inviteCoGuardian(
    actor: Actor,
    childId: string,
    rawPhone: string,
  ): Promise<PendingInviteView> {
    const phone = toE164(rawPhone);
    if (!phone || !/^\+998\d{9}$/.test(phone)) throw new PhoneInvalidException();

    const already = await this.db.one<{ ok: boolean }>(
      `SELECT true AS ok
         FROM guardianship g JOIN person p ON p.id = g.person_id
        WHERE g.child_id = $1 AND g.revoked_at IS NULL AND p.phone = $2`,
      [childId, phone],
    );
    if (already) throw new AlreadyGuardianException();

    const invite = await this.upsertInvite(actor, childId, phone, 'co_guardian');
    await this.sendInvite(actor, childId, phone, 'co_guardian', invite.code);

    await this.audit.write({
      action: 'guardian.invited',
      personId: actor.personId,
      payload: { childId, inviteId: invite.id, phoneMasked: maskPhone(phone) },
    });

    return (await this.forChild(actor, childId)).pending.find((p) => p.id === invite.id)!;
  }

  async cancelInvite(actor: Actor, childId: string, inviteId: string): Promise<void> {
    const row = await this.db.one<{ kind: InviteKind }>(
      `UPDATE guardian_invite SET cancelled_at = now()
        WHERE id = $1 AND child_id = $2 AND accepted_at IS NULL AND cancelled_at IS NULL
        RETURNING kind`,
      [inviteId, childId],
    );
    if (!row) throw new NotFoundException({ error: 'NOT_FOUND' });

    await this.audit.write({
      action: row.kind === 'ownership_transfer' ? 'ownership.transfer_cancelled' : 'guardian.invite_cancelled',
      personId: actor.personId,
      payload: { childId, inviteId },
    });
  }

  /**
   * The owner takes a co-guardian off the profile. Never the owner: ownership
   * leaves only by transfer (INV-03/INV-04). An open transfer offer to that
   * person dies with their access.
   */
  async removeCoGuardian(actor: Actor, childId: string, personId: string): Promise<void> {
    const removed = await this.db.transaction(async (client) => {
      const row = await client.query<{ id: string }>(
        `UPDATE guardianship SET revoked_at = now()
          WHERE child_id = $1 AND person_id = $2
            AND role = 'co_guardian' AND revoked_at IS NULL
          RETURNING id`,
        [childId, personId],
      );
      if (!row.rowCount) return false;

      await client.query(
        `UPDATE guardian_invite gi SET cancelled_at = now()
           FROM person p
          WHERE p.id = $2 AND gi.phone_e164 = p.phone AND gi.child_id = $1
            AND gi.accepted_at IS NULL AND gi.cancelled_at IS NULL`,
        [childId, personId],
      );

      await this.notify.queue(
        {
          personId,
          template: 'guardian_removed',
          vars: {
            child: await this.family.childName(childId, client),
            owner: await this.family.personName(actor.personId, client),
          },
        },
        client,
      );
      return true;
    });
    if (!removed) throw new NotFoundException({ error: 'NOT_FOUND' });

    await this.actors.invalidate(personId);
    await this.audit.write({
      action: 'guardian.removed',
      personId: actor.personId,
      payload: { childId, guardianPersonId: personId },
    });
  }

  // ------------------------------------------------- ownership transfer

  /**
   * task.md § 3: "Transfer ownership — ✅ (to a co-guardian, who must accept)".
   * The owner stays the owner until the co-guardian accepts (design/06: "You
   * stay the owner until Rustam confirms").
   *
   * Identified by phone, like every invitation, but it must be the phone of a
   * CURRENT co-guardian of this child — a transfer is never the way to bring a
   * stranger in.
   */
  async offerTransfer(
    actor: Actor,
    childId: string,
    to: { phone?: string; personId?: string },
  ): Promise<PendingInviteView> {
    const phone = to.phone ? toE164(to.phone) : null;
    if (to.phone && !phone) throw new PhoneInvalidException();
    if (!phone && !to.personId) throw new NotACoGuardianException();

    const target = await this.db.one<{ person_id: string; phone: string }>(
      `SELECT g.person_id, p.phone
         FROM guardianship g JOIN person p ON p.id = g.person_id
        WHERE g.child_id = $1 AND g.role = 'co_guardian' AND g.revoked_at IS NULL
          AND ($2::text IS NULL OR p.phone = $2)
          AND ($3::uuid IS NULL OR p.id = $3::uuid)`,
      [childId, phone, to.personId ?? null],
    );
    if (!target) throw new NotACoGuardianException();

    // One open offer per child, whoever it is to. A second offer to the same
    // person is a re-send; to someone else it must be cancelled first, so the
    // owner never has two people racing to accept.
    const open = await this.db.one<{ phone_e164: string }>(
      `SELECT phone_e164 FROM guardian_invite
        WHERE child_id = $1 AND kind = 'ownership_transfer'
          AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at > now()`,
      [childId],
    );
    if (open && open.phone_e164 !== target.phone) throw new TransferPendingException();

    const invite = await this.upsertInvite(actor, childId, target.phone, 'ownership_transfer');
    await this.sendInvite(actor, childId, target.phone, 'ownership_transfer', invite.code);

    await this.audit.write({
      action: 'ownership.transfer_offered',
      personId: actor.personId,
      payload: { childId, inviteId: invite.id, toPersonId: target.person_id },
    });

    return (await this.forChild(actor, childId)).pending.find((p) => p.id === invite.id)!;
  }

  async cancelTransfer(actor: Actor, childId: string): Promise<void> {
    const row = await this.db.one<{ id: string }>(
      `SELECT id FROM guardian_invite
        WHERE child_id = $1 AND kind = 'ownership_transfer'
          AND accepted_at IS NULL AND cancelled_at IS NULL`,
      [childId],
    );
    if (!row) throw new NotFoundException({ error: 'NOT_FOUND' });
    await this.cancelInvite(actor, childId, row.id);
  }

  // ------------------------------------------------------ the invitee

  /**
   * Accepts an invitation addressed to the caller's verified phone.
   *
   *   co_guardian         → a view-only guardianship
   *   ownership_transfer  → the swap: the old owner becomes a co-guardian and
   *                         the accepting co-guardian becomes the owner, in
   *                         one transaction (INV-03 / INV-04, deferred)
   */
  async accept(actor: Actor, code: string): Promise<{ childId: string; role: 'owner' | 'co_guardian' }> {
    const invite = await this.loadUsable(actor, code);

    const result = await this.db.transaction(async (client) => {
      // Re-read under lock: two taps on "accept" must not swap twice.
      const locked = await client.query<InviteRow>(
        `SELECT * FROM guardian_invite WHERE id = $1 AND accepted_at IS NULL
           AND cancelled_at IS NULL FOR UPDATE`,
        [invite.id],
      );
      if (!locked.rowCount) throw new InviteInvalidException('used');

      if (invite.kind === 'co_guardian') {
        const mine = await client.query<{ role: string }>(
          `SELECT role FROM guardianship
            WHERE child_id = $1 AND person_id = $2 AND revoked_at IS NULL`,
          [invite.child_id, actor.personId],
        );
        if (!mine.rowCount) {
          await client.query(
            `INSERT INTO guardianship (child_id, person_id, role, granted_by)
             VALUES ($1, $2, 'co_guardian', $3)`,
            [invite.child_id, actor.personId, invite.invited_by],
          );
        }
        await this.markAccepted(client, invite.id, actor.personId);
        await this.family.guardians(
          invite.child_id,
          'co_guardian_joined',
          {
            guardian: await this.family.personName(actor.personId, client),
            child: await this.family.childName(invite.child_id, client),
          },
          client,
        );
        return { role: 'co_guardian' as const, previousOwner: null };
      }

      // ownership_transfer: the offer is only good while its author still owns
      // the child and the invitee is still a co-guardian.
      const owner = await client.query<{ person_id: string }>(
        `SELECT person_id FROM guardianship
          WHERE child_id = $1 AND role = 'owner' AND revoked_at IS NULL FOR UPDATE`,
        [invite.child_id],
      );
      if (owner.rows[0]?.person_id !== invite.invited_by) throw new InviteInvalidException('used');

      const co = await client.query(
        `UPDATE guardianship SET revoked_at = now()
          WHERE child_id = $1 AND person_id = $2 AND role = 'co_guardian' AND revoked_at IS NULL
          RETURNING id`,
        [invite.child_id, actor.personId],
      );
      if (!co.rowCount) throw new NotACoGuardianException();

      await client.query(
        `UPDATE guardianship SET revoked_at = now()
          WHERE child_id = $1 AND person_id = $2 AND role = 'owner' AND revoked_at IS NULL`,
        [invite.child_id, invite.invited_by],
      );
      await client.query(
        `INSERT INTO guardianship (child_id, person_id, role, granted_by)
         VALUES ($1, $2, 'owner', $3), ($1, $3, 'co_guardian', $2)`,
        [invite.child_id, actor.personId, invite.invited_by],
      );
      await this.markAccepted(client, invite.id, actor.personId);

      await this.family.guardians(
        invite.child_id,
        'ownership_changed',
        {
          child: await this.family.childName(invite.child_id, client),
          owner: await this.family.personName(actor.personId, client),
          previous: await this.family.personName(invite.invited_by, client),
        },
        client,
      );
      return { role: 'owner' as const, previousOwner: invite.invited_by };
    });

    await this.actors.invalidate(actor.personId, invite.invited_by);
    await this.audit.write({
      action: result.role === 'owner' ? 'ownership.transferred' : 'guardian.invite_accepted',
      personId: actor.personId,
      payload:
        result.role === 'owner'
          ? { childId: invite.child_id, toPersonId: actor.personId, fromPersonId: invite.invited_by }
          : { childId: invite.child_id, guardianPersonId: actor.personId, inviteId: invite.id },
    });
    return { childId: invite.child_id, role: result.role };
  }

  async decline(actor: Actor, code: string): Promise<void> {
    const invite = await this.loadUsable(actor, code);
    await this.db.query(`UPDATE guardian_invite SET cancelled_at = now() WHERE id = $1`, [invite.id]);
    await this.audit.write({
      action: 'guardian.invite_declined',
      personId: actor.personId,
      payload: { childId: invite.child_id, inviteId: invite.id, kind: invite.kind },
    });
  }

  // ------------------------------------------------------------ helpers

  /**
   * The invite behind `code`, if the caller may use it. The phone check is
   * the whole security model: a forwarded link is useless to anyone but the
   * person whose number the owner typed.
   */
  private async loadUsable(actor: Actor, code: string): Promise<InviteRow> {
    const row = await this.db.one<InviteRow & { me_phone: string }>(
      `SELECT gi.*, (SELECT phone FROM person WHERE id = $2) AS me_phone
         FROM guardian_invite gi WHERE gi.code = $1`,
      [code, actor.personId],
    );
    if (!row) throw new InviteInvalidException('not_found');
    if (row.phone_e164 !== row.me_phone) {
      // Indistinguishable from "no such invite" on purpose: the link must not
      // confirm to a stranger that a child exists behind it.
      throw new InviteInvalidException('not_found');
    }
    if (row.accepted_at || row.cancelled_at) throw new InviteInvalidException('used');
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new InviteInvalidException('expired');
    return row;
  }

  private async upsertInvite(
    actor: Actor,
    childId: string,
    phone: string,
    kind: InviteKind,
  ): Promise<{ id: string; code: string }> {
    const existing = await this.db.one<{ id: string; code: string }>(
      `UPDATE guardian_invite
          SET expires_at = now() + make_interval(days => $4), invited_by = $5
        WHERE child_id = $1 AND phone_e164 = $2 AND kind = $3
          AND accepted_at IS NULL AND cancelled_at IS NULL
        RETURNING id, code`,
      [childId, phone, kind, INVITE_TTL_DAYS, actor.personId],
    );
    if (existing) return existing;

    const row = await this.db.one<{ id: string; code: string }>(
      `INSERT INTO guardian_invite (child_id, invited_by, phone_e164, kind, code, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
       RETURNING id, code`,
      [childId, actor.personId, phone, kind, randomToken(12), INVITE_TTL_DAYS],
    );
    return row!;
  }

  /**
   * Telegram for a person already on Zinapo, SMS for a number that is not
   * (task.md § 10). The link carries the code; the code alone is useless
   * without signing in with that phone.
   */
  private async sendInvite(
    actor: Actor,
    childId: string,
    phone: string,
    kind: InviteKind,
    code: string,
  ): Promise<void> {
    const person = await this.db.one<{ id: string; locale: string }>(
      `SELECT id, locale FROM person WHERE phone = $1`,
      [phone],
    );
    const locale = person?.locale === 'ru' ? 'ru' : 'uz';
    await this.notify.queue({
      personId: person?.id ?? null,
      phone: person ? null : phone,
      template: kind === 'ownership_transfer' ? 'ownership_transfer' : 'co_guardian_invite',
      vars: {
        inviter: await this.family.personName(actor.personId),
        child: await this.family.childName(childId),
        link: `${this.config.webOrigin}/${locale}/guardian-invite/${code}`,
      },
    });
  }

  private async markAccepted(client: PoolClient, inviteId: string, personId: string): Promise<void> {
    await client.query(
      `UPDATE guardian_invite SET accepted_by = $2, accepted_at = now() WHERE id = $1`,
      [inviteId, personId],
    );
  }
}
