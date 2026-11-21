import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Env } from '../config/env';
import { AttachmentsController } from './attachments.controller';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        // Uploads land in a temp folder first and are moved once checked.
        const dest = resolve(config.get('STORAGE_DIR', { infer: true }), 'tmp');
        mkdirSync(dest, { recursive: true });
        return {
          dest,
          limits: { fileSize: config.get('MAX_UPLOAD_MB', { infer: true }) * 1024 * 1024, files: 1 },
        };
      },
    }),
  ],
  controllers: [AttachmentsController],
})
export class FilesModule {}
