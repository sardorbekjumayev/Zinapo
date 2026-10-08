import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig, CONFIG } from '../config/configuration';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.client = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /**
   * Counter-style rate limit: increments `key`, sets the TTL on first hit.
   * Returns true when the call is still within `limit`.
   */
  async rateLimit(key: string, limit: number, ttlSeconds: number): Promise<boolean> {
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, ttlSeconds);
    return count <= limit;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }
}
