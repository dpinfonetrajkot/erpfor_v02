import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { customerSchema, listQuerySchema, type CustomerInput, type ListQuery } from '@bht/shared';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../common/auth-user';
import { CustomersService } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('customers.view')
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery) {
    return this.customers.list(query);
  }

  @Get(':id')
  @RequirePermission('customers.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.customers.get(id);
  }

  @Post()
  @RequirePermission('customers.create')
  create(@Body(new ZodValidationPipe(customerSchema)) body: CustomerInput, @CurrentActor() actor: Actor) {
    return this.customers.create(body, actor);
  }

  @Put(':id')
  @RequirePermission('customers.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(customerSchema)) body: CustomerInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.customers.update(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('customers.delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.customers.remove(id, actor);
  }
}
