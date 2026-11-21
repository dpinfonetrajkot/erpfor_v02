import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  listQuerySchema,
  materialGradeSchema,
  rawMaterialSchema,
  type MaterialGradeInput,
  type RawMaterialInput,
} from '@bht/shared';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../common/auth-user';
import { RawMaterialsService } from './raw-materials.service';

const rawMaterialQuerySchema = listQuerySchema.extend({
  gradeId: z.coerce.number().int().positive().optional(),
});

@Controller()
export class RawMaterialsController {
  constructor(private readonly rawMaterials: RawMaterialsService) {}

  // ------------------------------------------------------------ material grades

  @Get('material-grades')
  @RequirePermission('raw_materials.view', 'items.view')
  listGrades() {
    return this.rawMaterials.listGrades();
  }

  @Post('material-grades')
  @RequirePermission('raw_materials.create')
  createGrade(@Body(new ZodValidationPipe(materialGradeSchema)) body: MaterialGradeInput, @CurrentActor() actor: Actor) {
    return this.rawMaterials.saveGrade(null, body, actor);
  }

  @Put('material-grades/:id')
  @RequirePermission('raw_materials.update')
  updateGrade(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(materialGradeSchema)) body: MaterialGradeInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.rawMaterials.saveGrade(id, body, actor);
  }

  @Delete('material-grades/:id')
  @HttpCode(204)
  @RequirePermission('raw_materials.delete')
  removeGrade(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.rawMaterials.removeGrade(id, actor);
  }

  // -------------------------------------------------------------- raw materials

  @Get('raw-materials')
  @RequirePermission('raw_materials.view')
  list(@Query(new ZodValidationPipe(rawMaterialQuerySchema)) query: z.infer<typeof rawMaterialQuerySchema>) {
    return this.rawMaterials.list(query, query.gradeId);
  }

  @Get('raw-materials/:id')
  @RequirePermission('raw_materials.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.rawMaterials.get(id);
  }

  @Post('raw-materials')
  @RequirePermission('raw_materials.create')
  create(@Body(new ZodValidationPipe(rawMaterialSchema)) body: RawMaterialInput, @CurrentActor() actor: Actor) {
    return this.rawMaterials.create(body, actor);
  }

  @Put('raw-materials/:id')
  @RequirePermission('raw_materials.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(rawMaterialSchema)) body: RawMaterialInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.rawMaterials.update(id, body, actor);
  }

  @Delete('raw-materials/:id')
  @HttpCode(204)
  @RequirePermission('raw_materials.delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.rawMaterials.remove(id, actor);
  }
}
