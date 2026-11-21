import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { HeatsController } from './heats.controller';
import { HeatsService } from './heats.service';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { LookupsController } from './lookups.controller';
import { ProcessStagesController } from './process-stages.controller';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { RawMaterialsController } from './raw-materials.controller';
import { RawMaterialsService } from './raw-materials.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { ToolsController } from './tools.controller';

@Module({
  controllers: [
    CustomersController,
    SuppliersController,
    ProductsController,
    ItemsController,
    RawMaterialsController,
    HeatsController,
    ProcessStagesController,
    ToolsController,
    LookupsController,
  ],
  providers: [
    CustomersService,
    SuppliersService,
    ProductsService,
    ItemsService,
    RawMaterialsService,
    HeatsService,
  ],
})
export class MastersModule {}
