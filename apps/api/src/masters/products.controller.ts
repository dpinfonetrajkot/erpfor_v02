import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  END_CONNECTIONS,
  listQuerySchema,
  partTypeSchema,
  productCategorySchema,
  productSchema,
  type PartTypeInput,
  type ProductCategoryInput,
  type ProductInput,
} from '@bht/shared';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../common/auth-user';
import { ProductsService } from './products.service';

const productQuerySchema = listQuerySchema.extend({
  categoryId: z.coerce.number().int().positive().optional(),
});
const generateItemsSchema = z.object({ endConnections: z.array(z.enum(END_CONNECTIONS)).default([]) });

@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // ---------------------------------------------------------------- categories

  @Get('product-categories')
  @RequirePermission('products.view')
  listCategories() {
    return this.products.listCategories();
  }

  @Post('product-categories')
  @RequirePermission('products.create')
  createCategory(
    @Body(new ZodValidationPipe(productCategorySchema)) body: ProductCategoryInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.products.saveCategory(null, body, actor);
  }

  @Put('product-categories/:id')
  @RequirePermission('products.update')
  updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(productCategorySchema)) body: ProductCategoryInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.products.saveCategory(id, body, actor);
  }

  @Delete('product-categories/:id')
  @HttpCode(204)
  @RequirePermission('products.delete')
  removeCategory(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.products.removeCategory(id, actor);
  }

  // ---------------------------------------------------------------- part types

  @Get('part-types')
  @RequirePermission('products.view', 'items.view')
  listPartTypes() {
    return this.products.listPartTypes();
  }

  @Post('part-types')
  @RequirePermission('products.create')
  createPartType(@Body(new ZodValidationPipe(partTypeSchema)) body: PartTypeInput, @CurrentActor() actor: Actor) {
    return this.products.savePartType(null, body, actor);
  }

  @Put('part-types/:id')
  @RequirePermission('products.update')
  updatePartType(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(partTypeSchema)) body: PartTypeInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.products.savePartType(id, body, actor);
  }

  @Delete('part-types/:id')
  @HttpCode(204)
  @RequirePermission('products.delete')
  removePartType(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.products.removePartType(id, actor);
  }

  // ------------------------------------------------------------------ products

  @Get('products')
  @RequirePermission('products.view')
  list(@Query(new ZodValidationPipe(productQuerySchema)) query: z.infer<typeof productQuerySchema>) {
    return this.products.list(query, query.categoryId);
  }

  @Get('products/:id')
  @RequirePermission('products.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.products.get(id);
  }

  @Post('products')
  @RequirePermission('products.create')
  create(@Body(new ZodValidationPipe(productSchema)) body: ProductInput, @CurrentActor() actor: Actor) {
    return this.products.create(body, actor);
  }

  @Put('products/:id')
  @RequirePermission('products.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(productSchema)) body: ProductInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.products.update(id, body, actor);
  }

  @Delete('products/:id')
  @HttpCode(204)
  @RequirePermission('products.delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.products.remove(id, actor);
  }

  @Post('products/:id/generate-items')
  @RequirePermission('items.create')
  generateItems(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(generateItemsSchema)) body: z.infer<typeof generateItemsSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.products.generateItems(id, body.endConnections, actor);
  }
}
