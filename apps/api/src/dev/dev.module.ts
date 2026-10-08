import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { DevController } from './dev.controller';
import { SeedController } from './seed.controller';
import { SeedService } from './seed.service';

/** Development only — `app.module.ts` does not register this in production. */
@Module({
  imports: [AuthModule, TelegramModule],
  controllers: [DevController, SeedController],
  providers: [SeedService],
})
export class DevModule {}
