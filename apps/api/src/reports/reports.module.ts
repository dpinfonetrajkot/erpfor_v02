import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ReportsController, TraceabilityController } from './reports.controller';
import { TraceabilityService } from './traceability.service';
import { ReportsService } from './reports.service';
import { BusinessReportsService } from './business-reports.service';

@Module({
  imports: [BillingModule],
  controllers: [TraceabilityController, ReportsController],
  providers: [TraceabilityService, ReportsService, BusinessReportsService],
  exports: [TraceabilityService, ReportsService, BusinessReportsService],
})
export class ReportsModule {}
