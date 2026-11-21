import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { itemSchema, listQuerySchema, type ItemInput } from '@bht/shared';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../common/auth-user';
import { ItemsService } from './items.service';

const itemQuerySchema = listQuerySchema.extend({
  productId: z.coerce.number().int().positive().optional(),
  partTypeId: z.coerce.number().int().positive().optional(),
});

@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @RequirePermission('items.view')
  list(@Query(new ZodValidationPipe(itemQuerySchema)) query: z.infer<typeof itemQuerySchema>) {
    return this.items.list(query, query);
  }

  @Get(':id')
  @RequirePermission('items.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.items.get(id);
  }

  @Post()
  @RequirePermission('items.create')
  create(@Body(new ZodValidationPipe(itemSchema)) body: ItemInput, @CurrentActor() actor: Actor) {
    return this.items.create(body, actor);
  }

  @Put(':id')
  @RequirePermission('items.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(itemSchema)) body: ItemInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.items.update(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('items.delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.items.remove(id, actor);
  }
}
