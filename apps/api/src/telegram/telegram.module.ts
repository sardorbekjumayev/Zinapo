import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TelegramController } from './telegram.controller';
import { TelegramFlowService } from './telegram-flow.service';
import { TelegramService } from './telegram.service';

@Module({
  imports: [AuthModule],
  controllers: [TelegramController],
  providers: [TelegramFlowService, TelegramService],
  exports: [TelegramFlowService, TelegramService],
})
export class TelegramModule {}
