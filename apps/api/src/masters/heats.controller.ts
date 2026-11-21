import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { HEAT_STATUSES, heatSchema, listQuerySchema, type HeatInput } from '@bht/shared';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../common/auth-user';
import { HeatsService } from './heats.service';

const heatQuerySchema = listQuerySchema.extend({
  rawMaterialId: z.coerce.number().int().positive().optional(),
  status: z.enum(HEAT_STATUSES).optional(),
});

@Controller('heats')
export class HeatsController {
  constructor(private readonly heats: HeatsService) {}

  @Get()
  @RequirePermission('heats.view')
  list(@Query(new ZodValidationPipe(heatQuerySchema)) query: z.infer<typeof heatQuerySchema>) {
    return this.heats.list(query, query);
  }

  @Get(':id')
  @RequirePermission('heats.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.heats.get(id);
  }

  @Post()
  @RequirePermission('heats.create')
  create(@Body(new ZodValidationPipe(heatSchema)) body: HeatInput, @CurrentActor() actor: Actor) {
    return this.heats.create(body, actor);
  }

  @Put(':id')
  @RequirePermission('heats.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(heatSchema)) body: HeatInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.heats.update(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('heats.delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.heats.remove(id, actor);
  }
}
