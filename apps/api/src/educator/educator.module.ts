import { Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BankModule } from '../bank/bank.module';
import { ApplicationService } from './application.service';
import { InvitesService } from './invites.service';
import { GroupsService } from './groups.service';
import { PracticeService } from './practice.service';
import {
  EducatorApplicationController,
  EducatorGroupsController,
  EducatorInvitesController,
  EducatorPracticeController,
  FamilyPracticeController,
  PublicInviteController,
  StaffEducatorController,
} from './educator.controller';

const TICK_MS = 5 * 60_000;

/**
 * task.md § 12 M6 — the educator workspace: application and approval,
 * invites, the PINFL match-check and access requests, groups, the group
 * overview and pupil view, and practice.
 *
 * Its one job runs every five minutes: access requests nobody answered in
 * 14 days become `expired` (one live request per pair, § 8.4.2).
 */
@Module({
  imports: [BankModule],
  controllers: [
    EducatorApplicationController,
    EducatorInvitesController,
    EducatorGroupsController,
    EducatorPracticeController,
    FamilyPracticeController,
    StaffEducatorController,
    PublicInviteController,
  ],
  providers: [ApplicationService, InvitesService, GroupsService, PracticeService],
  exports: [InvitesService, PracticeService, GroupsService],
})
export class EducatorModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EducatorModule.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly invites: InvitesService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.invites
        .expireLapsedRequests()
        .then((n) => n && this.logger.log(`expired ${n} lapsed access request(s)`))
        .catch((err: Error) => this.logger.error(err.message));
    }, TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
