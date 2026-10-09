import { Global, Module } from '@nestjs/common';
import { CasesService } from './cases.service';
import { FraudRulesService } from './fraud-rules.service';
import { QueueService } from './queue.service';
import { FamilyTrustController, StaffCasesController } from './queue.controller';

/**
 * task.md § 6 (`trust`): opening cases (M2), and since M8 the fraud rules job,
 * the one queue with its resolutions, and the family side — dispute
 * statements and the owner's answer to a suspended link.
 */
@Global()
@Module({
  controllers: [StaffCasesController, FamilyTrustController],
  providers: [CasesService, FraudRulesService, QueueService],
  exports: [CasesService, FraudRulesService, QueueService],
})
export class TrustModule {}
