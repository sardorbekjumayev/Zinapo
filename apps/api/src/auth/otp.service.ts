import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomInt } from 'crypto';
import { AppConfig, CONFIG } from '../config/configuration';
import { hexEquals } from '../common/crypto.util';

@Injectable()
export class OtpService {
  private readonly secret: string;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.secret = config.otpSecret;
  }

  /** 5 digits, zero-padded, from a CSPRNG. */
  generate(): string {
    return randomInt(0, 100_000).toString().padStart(5, '0');
  }

  hash(requestId: string, code: string): string {
    return createHmac('sha256', this.secret).update(`${requestId}:${code}`).digest('hex');
  }

  equals(a: string, b: string): boolean {
    return hexEquals(a, b);
  }
}
