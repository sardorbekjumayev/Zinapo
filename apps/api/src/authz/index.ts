/**
 * The one import a feature module needs:
 *
 *   import {
 *     Guarded, CurrentActor, ChildAccess, ResolvedChild,
 *     RequirePermission, type Actor,
 *   } from '../authz';
 */
export * from './actor';
export * from './actor.service';
export * from './staff-permissions';
export * from './policies/child.policy';
export * from './policies/staff.policy';
export * from './guards/session.guard';
export * from './guards/staff-role.guard';
export * from './guards/child-access.guard';
export * from './decorators/authz.decorators';
export { Guarded } from './guarded.decorator';
