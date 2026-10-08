import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ActorService } from './actor.service';
import { ChildPolicy } from './policies/child.policy';
import { StaffPolicy } from './policies/staff.policy';
import { SessionGuard } from './guards/session.guard';
import { StaffRoleGuard } from './guards/staff-role.guard';
import { ChildAccessGuard } from './guards/child-access.guard';

/**
 * ONE policy layer, used everywhere (task.md § 4). Role checks never get
 * scattered across controllers: a controller declares what it needs with
 * `@RequireStaffRole` / `@RequirePermission` / `@ChildAccess` and the guards
 * here do the work.
 *
 * Global, because every feature module needs the guards and nobody should have
 * to remember to import them.
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [
    ActorService,
    ChildPolicy,
    StaffPolicy,
    SessionGuard,
    StaffRoleGuard,
    ChildAccessGuard,
  ],
  exports: [
    // Re-exported so that `@Guarded()` in any feature module can instantiate
    // SessionGuard: Nest builds route guards in the *consuming* module's
    // injector, and SessionGuard needs SessionService there.
    AuthModule,
    ActorService,
    ChildPolicy,
    StaffPolicy,
    SessionGuard,
    StaffRoleGuard,
    ChildAccessGuard,
  ],
})
export class AuthzModule {}
