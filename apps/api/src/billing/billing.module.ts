import { Module } from '@nestjs/common';
import { AssembliesController, DispatchesController, InvoicesController, PaymentsController } from './billing.controller';
import { AssembliesService } from './assemblies.service';
import { DispatchesService } from './dispatches.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [AssembliesController, InvoicesController, DispatchesController, PaymentsController],
  providers: [AssembliesService, InvoicesService, DispatchesService, PaymentsService],
  // reports build the receivables / payables ageing from the same outstanding list
  exports: [PaymentsService],
})
export class BillingModule {}
