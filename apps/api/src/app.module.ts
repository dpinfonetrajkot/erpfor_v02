import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { CoreModule } from './core/core.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { MastersModule } from './masters/masters.module';
import { FilesModule } from './files/files.module';
import { PurchaseModule } from './purchase/purchase.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { InventoryModule } from './inventory/inventory.module';
import { SalesModule } from './sales/sales.module';
import { ProductionModule } from './production/production.module';
import { JobWorkModule } from './jobwork/job-work.module';
import { BillingModule } from './billing/billing.module';
import { ReportsModule } from './reports/reports.module';
import { HrModule } from './hr/hr.module';
import { AssistantModule } from './assistant/assistant.module';
import { CommunicationModule } from './communication/communication.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { BackupModule } from './backup/backup.module';
import { TallyModule } from './tally/tally.module';
import { ImportsModule } from './imports/imports.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { SerializeInterceptor } from './common/serialize.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // 300 requests / minute per IP overall; login has its own stricter limit.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    CoreModule,
    AuthModule,
    AdminModule,
    MastersModule,
    FilesModule,
    PurchaseModule,
    ReceiptsModule,
    InventoryModule,
    SalesModule,
    ProductionModule,
    JobWorkModule,
    BillingModule,
    ReportsModule,
    HrModule,
    AssistantModule,
    CommunicationModule,
    DashboardModule,
    BackupModule,
    TallyModule,
    ImportsModule,
  ],
  providers: [
    // Throttler runs first so floods are stopped before any database work.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: SerializeInterceptor },
  ],
})
export class AppModule {}
