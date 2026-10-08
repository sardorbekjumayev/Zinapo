import { Global, Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { NotifyService } from './notify.service';
import { NotifyDispatcher } from './notify.dispatcher';

/**
 * task.md § 6 (`notify`). Global because almost every write in the product
 * owes someone a message — an access change, a wave opening, a case needing the
 * owner's confirmation.
 *
 * Only `NotifyService` is exported. Nothing outside this module should know
 * that a dispatcher exists, let alone call it.
 */
@Global()
@Module({
  imports: [TelegramModule],
  providers: [NotifyService, NotifyDispatcher],
  exports: [NotifyService],
})
export class NotifyModule {}
