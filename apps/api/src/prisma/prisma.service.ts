import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../generated/prisma/client';
import type { Env } from '../config/env';
import { createAdapter } from './create-adapter';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({ adapter: createAdapter(config.get('DATABASE_URL', { infer: true })) });
  }

  /** Connect in the background: hosting needs the server listening within a few seconds. */
  onModuleInit() {
    this.$connect().catch((err: Error) => Logger.error(`Database connection failed: ${err.message}`, 'Prisma'));
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/** The client passed into `$transaction(async (tx) => ...)` callbacks. */
export type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];
