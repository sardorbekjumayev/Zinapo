import { Controller, Get, Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { CommonModule } from './common/common.module';
import { DbModule } from './db/db.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { AuthzModule } from './authz/authz.module';
import { IdentityModule } from './identity/identity.module';
import { MeModule } from './me/me.module';
import { NotifyModule } from './notify/notify.module';
import { TrustModule } from './trust/trust.module';
import { TelegramModule } from './telegram/telegram.module';
import { DevModule } from './dev/dev.module';

@Controller('health')
class HealthController {
  @Get()
  health() {
    return { ok: true };
  }
}

const devModules = process.env.NODE_ENV === 'production' ? [] : [DevModule];

@Module({
  imports: [
    AppConfigModule,
    DbModule,
    RedisModule,
    CommonModule,
    AuthModule,
    AuthzModule,
    NotifyModule,
    TrustModule,
    IdentityModule,
    MeModule,
    TelegramModule,
    ...devModules,
  ],
  controllers: [HealthController],
})
export class AppModule {}
