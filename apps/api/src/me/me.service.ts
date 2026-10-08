import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { maskPhoneForDisplay } from '../common/phone.util';
import { ActorService, Actor, Workspace, workspacesOf } from '../authz';
import { permissionsOf } from '../authz/staff-permissions';

export interface MeResponse {
  person: { id: string; fullName: string; phone: string; locale: string };
  workspaces: Workspace[];
  family?: { ownerOf: number; coGuardianOf: number };
  educator?: { status: string; activeChildren: number };
  staff?: { roles: string[]; permissions: string[] };
  lastWorkspace: Workspace | null;
}

@Injectable()
export class MeService {
  constructor(
    private readonly db: DbService,
    private readonly actors: ActorService,
    private readonly audit: AuditService,
  ) {}

  /**
   * task.md § 2.2. The shape is driven by the workspaces the actor actually
   * has: a person with no relationships gets `workspaces: []` and the client
   * sends them to onboarding.
   *
   * The phone is masked (`+99890•••4567`). The full number is never needed by
   * the client, and masking here means it cannot leak through a screenshot or a
   * client-side log.
   */
  async describe(actor: Actor): Promise<MeResponse> {
    const person = await this.db.one<{
      id: string;
      full_name: string;
      phone: string;
      locale: string;
    }>(`SELECT id, full_name, phone, locale FROM person WHERE id = $1`, [actor.personId]);
    // SessionGuard already proved the person exists.
    if (!person) throw new Error(`actor ${actor.personId} vanished mid-request`);

    const workspaces = workspacesOf(actor);
    const out: MeResponse = {
      person: {
        id: person.id,
        fullName: person.full_name,
        phone: maskPhoneForDisplay(person.phone),
        locale: person.locale,
      },
      workspaces,
      // task.md § 2.2: a person with several workspaces lands on their last
      // one. Only report it when it is still one they may enter.
      lastWorkspace:
        actor.lastWorkspace && workspaces.includes(actor.lastWorkspace)
          ? actor.lastWorkspace
          : (workspaces[0] ?? null),
    };

    if (workspaces.includes('family')) {
      out.family = { ownerOf: actor.ownerOf, coGuardianOf: actor.coGuardianOf };
    }

    if (workspaces.includes('educator')) {
      // INV-15: counted through the view, like every other educator read.
      const row = await this.db.one<{ n: string }>(
        `SELECT count(*) AS n FROM v_educator_visible_child WHERE educator_person_id = $1`,
        [actor.personId],
      );
      out.educator = {
        status: actor.educatorStatus ?? 'applied',
        activeChildren: Number(row?.n ?? 0),
      };
    }

    if (workspaces.includes('staff')) {
      out.staff = {
        roles: [...actor.staffRoles],
        // The client uses these to hide what the actor cannot do. The API
        // checks again on every call — the list is a convenience, not a gate.
        permissions: [...permissionsOf(actor.staffRoles)],
      };
    }

    return out;
  }

  async updateProfile(
    actor: Actor,
    patch: { fullName?: string; locale?: string },
  ): Promise<{ fullName: string; locale: string }> {
    const row = await this.db.one<{ full_name: string; locale: string }>(
      `UPDATE person
          SET full_name  = COALESCE($2, full_name),
              locale     = COALESCE($3, locale),
              updated_at = now()
        WHERE id = $1
        RETURNING full_name, locale`,
      [actor.personId, patch.fullName ?? null, patch.locale ?? null],
    );
    if (!row) throw new Error(`actor ${actor.personId} vanished mid-request`);
    return { fullName: row.full_name, locale: row.locale };
  }

  /**
   * Remembers which workspace to open next time. Rejected for a workspace the
   * actor does not hold, so a stale client cannot park someone on a screen they
   * will only be bounced off.
   */
  async setWorkspace(actor: Actor, workspace: Workspace): Promise<boolean> {
    if (!workspacesOf(actor).includes(workspace)) return false;

    await this.db.query(
      `UPDATE person SET last_workspace = $2, updated_at = now() WHERE id = $1`,
      [actor.personId, workspace],
    );
    // The Actor carries lastWorkspace, so the cached copy is now wrong.
    await this.actors.invalidate(actor.personId);
    await this.audit.write({
      action: 'me.workspace_switched',
      personId: actor.personId,
      payload: { workspace },
    });
    return true;
  }
}
