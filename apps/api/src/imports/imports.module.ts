import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

/** Import from Excel: templates, checking a filled file, and importing it. */
@Module({
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
