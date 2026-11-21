import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { listQuerySchema, SUPPLIER_TYPES, supplierSchema, type SupplierInput } from '@bht/shared';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../common/auth-user';
import { SuppliersService } from './suppliers.service';

const supplierQuerySchema = listQuerySchema.extend({ type: z.enum(SUPPLIER_TYPES).optional() });

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission('suppliers.view')
  list(@Query(new ZodValidationPipe(supplierQuerySchema)) query: z.infer<typeof supplierQuerySchema>) {
    return this.suppliers.list(query, query.type);
  }

  @Get(':id')
  @RequirePermission('suppliers.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.suppliers.get(id);
  }

  @Post()
  @RequirePermission('suppliers.create')
  create(@Body(new ZodValidationPipe(supplierSchema)) body: SupplierInput, @CurrentActor() actor: Actor) {
    return this.suppliers.create(body, actor);
  }

  @Put(':id')
  @RequirePermission('suppliers.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(supplierSchema)) body: SupplierInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.suppliers.update(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('suppliers.delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.suppliers.remove(id, actor);
  }
}
