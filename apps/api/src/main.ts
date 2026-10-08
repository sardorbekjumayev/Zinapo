import 'reflect-metadata';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppConfig, CONFIG } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const config = app.get<AppConfig>(CONFIG);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.set('trust proxy', true);
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Validation failures must not echo the submitted code back.
      exceptionFactory: () => new BadRequestException({ error: 'VALIDATION_FAILED' }),
    }),
  );

  // Next.js proxies /api through a same-origin rewrite, so CORS is only
  // needed when the API is called directly from another origin in dev.
  if (!config.isProd) {
    app.enableCors({ origin: config.webOrigin, credentials: true });
  }

  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`Zinapo API listening on :${config.port}`);
}

void bootstrap();
