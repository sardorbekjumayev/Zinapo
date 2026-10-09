import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { EducatorSessionsController, FamilySessionsController, SessionsController } from './sessions.controller';

/**
 * task.md § 6 — `sessions`: start (snapshots), the offline bundle, response
 * ingest (idempotent), submit, and the wave job. Must never compute or store a
 * score.
 */
@Module({
  controllers: [FamilySessionsController, EducatorSessionsController, SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
