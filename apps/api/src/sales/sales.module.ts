import { Module } from '@nestjs/common';
import { ProductionRequestsController, SalesOrdersController } from './sales.controller';
import { ProductionRequestsService } from './production-requests.service';
import { SalesOrdersService } from './sales-orders.service';

@Module({
  controllers: [SalesOrdersController, ProductionRequestsController],
  providers: [SalesOrdersService, ProductionRequestsService],
  exports: [SalesOrdersService],
})
export class SalesModule {}
