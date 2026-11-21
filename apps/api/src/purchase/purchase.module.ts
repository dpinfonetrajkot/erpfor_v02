import { Module } from '@nestjs/common';
import { PurchaseOrdersController, PurchaseRequisitionsController } from './purchase.controller';
import { OrdersService } from './orders.service';
import { RequisitionsService } from './requisitions.service';

@Module({
  controllers: [PurchaseRequisitionsController, PurchaseOrdersController],
  providers: [RequisitionsService, OrdersService],
  exports: [OrdersService],
})
export class PurchaseModule {}
