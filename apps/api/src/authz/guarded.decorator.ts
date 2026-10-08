import { UseGuards, applyDecorators } from '@nestjs/common';
import { SessionGuard } from './guards/session.guard';
import { StaffRoleGuard } from './guards/staff-role.guard';
import { ChildAccessGuard } from './guards/child-access.guard';

/**
 * `@Guarded()` on a controller class: authenticate, then apply whatever the
 * route declared with `@RequireStaffRole` / `@RequirePermission` /
 * `@RequireWorkspace` / `@ChildAccess`.
 *
 * The order matters. `SessionGuard` attaches the Actor; the other two read it.
 * Keeping all three in one decorator means a new controller cannot accidentally
 * ship with the session check but without the authorisation check.
 */
export function Guarded(): ClassDecorator & MethodDecorator {
  return applyDecorators(UseGuards(SessionGuard, StaffRoleGuard, ChildAccessGuard));
}
