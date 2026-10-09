import { Module } from '@nestjs/common';
import { BankModule } from '../bank/bank.module';
import { SessionsModule } from '../sessions/sessions.module';
import { MeasurementModule } from '../measurement/measurement.module';
import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { DevController } from './dev.controller';
import { SeedController } from './seed.controller';
import { SeedService } from './seed.service';
import { SeedBankService } from './seed-bank.service';
import { SeedResultsService } from './seed-results.service';

/** Development only — `app.module.ts` does not register this in production. */
@Module({
  imports: [AuthModule, TelegramModule, BankModule, SessionsModule, MeasurementModule],
  controllers: [DevController, SeedController],
  providers: [SeedService, SeedBankService, SeedResultsService],
})
export class DevModule {}
