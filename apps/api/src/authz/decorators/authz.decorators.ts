import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { ACTOR_KEY, Actor, StaffRole, Workspace } from '../actor';
import { Permission } from '../staff-permissions';
import { ChildAccessResult, ChildScope } from '../policies/child.policy';
import { CHILD_ACCESS_KEY, CHILD_ACCESS_RESULT } from '../guards/child-access.guard';

export const STAFF_ROLE_KEY = 'znStaffRoles';
export const PERMISSION_KEY = 'znPermissions';
export const WORKSPACE_KEY = 'znWorkspace';

/**
 * `@RequireStaffRole('bank_editor')` — any one of the listed roles is enough.
 *
 * Prefer `@RequirePermission` where a capability is shared by several roles;
 * use this when the rule really is about the role itself.
 */
export const RequireStaffRole = (...roles: StaffRole[]) => SetMetadata(STAFF_ROLE_KEY, roles);

/** `@RequirePermission('form.freeze')` — the union over the actor's roles. */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSION_KEY, permissions);

/** `@RequireWorkspace('educator')` — the actor must have that workspace at all. */
export const RequireWorkspace = (workspace: Workspace) => SetMetadata(WORKSPACE_KEY, workspace);

/**
 * `@ChildAccess('educator_view')` — resolves the `:childId` route param (or
 * `:id` on a child route) through `ChildPolicy` and attaches the result.
 * A denial is a 404, never a 403: the existence of a child is itself private.
 */
export const ChildAccess = (scope: ChildScope) => SetMetadata(CHILD_ACCESS_KEY, scope);

/** `@CurrentActor() actor: Actor` */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const actor = Reflect.get(req, ACTOR_KEY) as Actor | undefined;
  if (!actor) {
    // A programming error, not a user error: the route forgot SessionGuard.
    throw new Error('@CurrentActor() used on a route without SessionGuard');
  }
  return actor;
});

/**
 * `@ResolvedChild() access: ChildAccessResult` — what `@ChildAccess(scope)`
 * worked out: the child id, which relationship authorised it, and whether a
 * percentile band may be included in the response.
 */
export const ResolvedChild = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ChildAccessResult => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const access = Reflect.get(req, CHILD_ACCESS_RESULT) as ChildAccessResult | undefined;
    if (!access) {
      throw new Error('@ResolvedChild() used on a route without @ChildAccess()');
    }
    return access;
  },
);
