function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export interface AppConfig {
  nodeEnv: string;
  isProd: boolean;
  port: number;
  webOrigin: string;
  cookieSecure: boolean;
  databaseUrl: string;
  redisUrl: string;
  otpSecret: string;
  jwtAccessSecret: string;
  /**
   * INV-06. Two independent keys, deliberately not one:
   *   `pinflHashSalt` makes the lookup hash unguessable — a leaked `pinfl_hash`
   *     column cannot be brute-forced against the 14-digit PINFL space.
   *   `pinflEncKey`  decrypts the stored PINFL for admission-list matching.
   * task.md § 11 wants the encryption key in a KMS or env, separate from the
   * database — so losing the DB dump never yields a PINFL.
   */
  pinflHashSalt: string;
  pinflEncKey: string;
  telegram: {
    token: string;
    username: string;
    webhookUrl: string;
    webhookSecret: string;
    enabled: boolean;
  };
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  return {
    nodeEnv,
    isProd: nodeEnv === 'production',
    port: Number(process.env.API_PORT ?? 4000),
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    databaseUrl: required('DATABASE_URL'),
    redisUrl: required('REDIS_URL'),
    otpSecret: required('OTP_HMAC_SECRET'),
    jwtAccessSecret: required('JWT_ACCESS_SECRET'),
    pinflHashSalt: required('PINFL_HASH_SALT'),
    pinflEncKey: required('PINFL_ENC_KEY'),
    telegram: {
      token,
      username: process.env.TELEGRAM_BOT_USERNAME ?? 'ZinapoBot',
      webhookUrl: process.env.TELEGRAM_WEBHOOK_URL ?? '',
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
      enabled: token.length > 0,
    },
  };
}

export const CONFIG = 'APP_CONFIG';
