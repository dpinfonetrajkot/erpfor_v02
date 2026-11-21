import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { LiveUpdates, LiveUpdatesController, LiveUpdatesInterceptor } from './live-updates';
import { NotificationsService } from './notifications.service';
import { MailService } from './mail.service';
import { NumberingService } from './numbering.service';
import { StockService } from './stock.service';

/** Services every business module uses: audit log, document numbers, stock ledger, e-mail, live updates. */
@Global()
@Module({
  controllers: [LiveUpdatesController],
  providers: [AuditService, NumberingService, StockService, MailService, LiveUpdates, NotificationsService, { provide: APP_INTERCEPTOR, useClass: LiveUpdatesInterceptor }],
  exports: [AuditService, NumberingService, StockService, MailService, LiveUpdates, NotificationsService],
})
export class CoreModule {}
