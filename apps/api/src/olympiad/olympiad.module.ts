import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { OlympiadAdminService } from './olympiad-admin.service';
import { OlympiadResultsService } from './olympiad-results.service';
import { FamilyOlympiadService } from './family-olympiad.service';
import { FinalsService } from './finals.service';
import {
  FamilyOlympiadController,
  PublicOlympiadController,
  StaffFinalsController,
  StaffOlympiadController,
  StaffOlympiadResultsController,
} from './olympiad.controller';

/**
 * task.md § 12 M7 — the olympiad: the operator's admin, family registration
 * and the online stages, results and awards, and the proctor's console with
 * the offline runner's package and sync.
 */
@Module({
  imports: [MediaModule],
  controllers: [
    StaffOlympiadController,
    StaffOlympiadResultsController,
    StaffFinalsController,
    FamilyOlympiadController,
    PublicOlympiadController,
  ],
  providers: [OlympiadAdminService, OlympiadResultsService, FamilyOlympiadService, FinalsService],
  exports: [OlympiadAdminService, OlympiadResultsService, FamilyOlympiadService, FinalsService],
})
export class OlympiadModule {}
