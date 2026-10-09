import { Module } from '@nestjs/common';
import { BankModule } from '../bank/bank.module';
import { SessionsModule } from '../sessions/sessions.module';
import { MeasurementModule } from '../measurement/measurement.module';
import { EducatorModule } from '../educator/educator.module';
import { OlympiadModule } from '../olympiad/olympiad.module';
import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { DevController } from './dev.controller';
import { SeedController } from './seed.controller';
import { SeedService } from './seed.service';
import { SeedBankService } from './seed-bank.service';
import { SeedResultsService } from './seed-results.service';
import { SeedEducatorService } from './seed-educator.service';
import { SeedOlympiadService } from './seed-olympiad.service';

/** Development only — `app.module.ts` does not register this in production. */
@Module({
  imports: [AuthModule, TelegramModule, BankModule, SessionsModule, MeasurementModule, EducatorModule, OlympiadModule],
  controllers: [DevController, SeedController],
  providers: [SeedService, SeedBankService, SeedResultsService, SeedEducatorService, SeedOlympiadService],
})
export class DevModule {}
