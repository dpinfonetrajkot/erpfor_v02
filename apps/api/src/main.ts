import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { brand } from './config/brand';
import type { Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Biometric machines post punches as plain text (whatever content type they claim): read those
  // bodies as text first, then the normal JSON / form parsers for everything else.
  app.useBodyParser('text', { type: (req) => (req.url ?? '').startsWith('/api/iclock'), limit: '5mb' });
  app.useBodyParser('json', { limit: '6mb' }); // attendance CSV import is sent as JSON

  app.useBodyParser('urlencoded', { extended: true });

  // The web app (Next.js) proxies /api to this server; trust its X-Forwarded-For.
  app.set('trust proxy', true);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  Logger.log(`${brand().short} ERP API running on http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
