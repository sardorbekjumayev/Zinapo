import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminService } from './admin.service';
import { OutcomesService } from './outcomes.service';
import { OutcomesController, SupportController, SuperAdminController } from './admin.controller';

/**
 * task.md § 12 M9 — admission outcomes (import, match inside the service,
 * review), support lookup, staff roles and the audit viewer.
 */
@Module({
  imports: [AuthModule],
  controllers: [OutcomesController, SupportController, SuperAdminController],
  providers: [AdminService, OutcomesService],
  exports: [OutcomesService],
})
export class AdminModule {}
