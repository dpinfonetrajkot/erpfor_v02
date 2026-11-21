import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ReportsModule } from '../reports/reports.module';
import { HrModule } from '../hr/hr.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AssistantCatalog } from './catalog';

@Module({
  imports: [BillingModule, ReportsModule, HrModule, DashboardModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantCatalog],
})
export class AssistantModule {}
