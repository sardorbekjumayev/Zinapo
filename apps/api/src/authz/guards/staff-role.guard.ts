import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ACTOR_KEY, Actor, StaffRole, Workspace, workspacesOf } from '../actor';
import { Permission, hasPermission } from '../staff-permissions';
import {
  APPROVED_EDUCATOR_KEY,
  PERMISSION_KEY,
  STAFF_ROLE_KEY,
  WORKSPACE_KEY,
} from '../decorators/authz.decorators';

/**
 * Enforces `@RequireStaffRole`, `@RequirePermission`, `@RequireWorkspace` and
 * `@RequireApprovedEducator`.
 *
 * task.md § 4: a denied **staff** action is `403`. That is the opposite of the
 * child rule — a staff endpoint's existence is not a secret, so saying "you
 * need the bank_editor role" is more useful than pretending the route is gone.
 */
@Injectable()
export class StaffRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = [context.getHandler(), context.getClass()];

    const roles = this.reflector.getAllAndOverride<StaffRole[]>(STAFF_ROLE_KEY, handler);
    const permissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSION_KEY, handler);
    const workspace = this.reflector.getAllAndOverride<Workspace>(WORKSPACE_KEY, handler);
    const educator = this.reflector.getAllAndOverride<boolean>(APPROVED_EDUCATOR_KEY, handler);

    if (!roles && !permissions && !workspace && !educator) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const actor = Reflect.get(req, ACTOR_KEY) as Actor | undefined;
    if (!actor) throw new ForbiddenException({ error: 'FORBIDDEN' });

    if (workspace && !workspacesOf(actor).includes(workspace)) {
      throw new ForbiddenException({ error: 'WORKSPACE_FORBIDDEN', details: { workspace } });
    }

    if (educator && actor.educatorStatus !== 'approved') {
      throw new ForbiddenException({ error: 'EDUCATOR_NOT_APPROVED', details: { status: actor.educatorStatus } });
    }

    if (roles && !roles.some((role) => actor.staffRoles.includes(role))) {
      throw new ForbiddenException({ error: 'STAFF_ROLE_REQUIRED', details: { roles } });
    }

    if (permissions && !permissions.every((p) => hasPermission(actor.staffRoles, p))) {
      throw new ForbiddenException({ error: 'PERMISSION_REQUIRED', details: { permissions } });
    }

    return true;
  }
}
