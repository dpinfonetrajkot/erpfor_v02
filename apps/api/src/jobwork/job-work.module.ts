import { Module } from '@nestjs/common';
import { PurchaseModule } from '../purchase/purchase.module';
import { SalesModule } from '../sales/sales.module';
import { JobWorkMaterialsController, JobWorkOrdersController, JobWorkReceiptsController } from './job-work.controller';
import { JobWorkService } from './job-work.service';

@Module({
  imports: [PurchaseModule, SalesModule],
  controllers: [JobWorkOrdersController, JobWorkReceiptsController, JobWorkMaterialsController],
  providers: [JobWorkService],
})
export class JobWorkModule {}
