import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  COMPLETION_STATUSES,
  completionMoveSchema,
  listQuerySchema,
  materialIssueSchema,
  materialRequestSchema,
  materialReturnSchema,
  MR_STATUSES,
  mrPurchaseSchema,
  operationRecordSchema,
  RC_STATUSES,
  reasonSchema,
  routeCardFieldsSchema,
  routeCardSchema,
  type CompletionMoveInput,
  type MaterialIssueInput,
  type MaterialRequestInput,
  type MaterialReturnInput,
  type MrPurchaseInput,
  type OperationRecordInput,
  type ReasonInput,
  type RouteCardFieldsInput,
  type RouteCardInput,
} from '@bht/shared';
import { CurrentActor, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor, AuthUser } from '../common/auth-user';
import { CompletionsService } from './completions.service';
import { MaterialService } from './material.service';
import { RouteCardsService } from './route-cards.service';

const RC_READERS = ['route_cards.view', 'route_card_operations.view', 'material_issues.view', 'rc_completions.view'];

const rcQuerySchema = listQuerySchema.extend({
  status: z.enum([...RC_STATUSES, 'ACTIVE']).optional(),
  stageId: z.coerce.number().int().positive().optional(),
  itemId: z.coerce.number().int().positive().optional(),
  mine: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});
const mrQuerySchema = listQuerySchema.extend({
  status: z.enum([...MR_STATUSES, 'OPEN']).optional(),
  routeCardId: z.coerce.number().int().positive().optional(),
});
const completionQuerySchema = listQuerySchema.extend({ status: z.enum(COMPLETION_STATUSES).optional() });
const requestIdSchema = z.object({ requestId: z.coerce.number().int().positive() });

@Controller('route-cards')
export class RouteCardsController {
  constructor(
    private readonly cards: RouteCardsService,
    private readonly material: MaterialService,
  ) {}

  @Get()
  @RequirePermission(...RC_READERS)
  list(@Query(new ZodValidationPipe(rcQuerySchema)) query: z.infer<typeof rcQuerySchema>, @CurrentUser() user: AuthUser) {
    return this.cards.list(query, query, user);
  }

  @Get('defaults')
  @RequirePermission('route_cards.create')
  defaults(@Query(new ZodValidationPipe(requestIdSchema)) q: z.infer<typeof requestIdSchema>) {
    return this.cards.defaults(q.requestId);
  }

  @Get(':id')
  @RequirePermission(...RC_READERS)
  get(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.cards.get(id, user);
  }

  @Get(':id/pdf')
  @RequirePermission(...RC_READERS)
  async pdf(@Param('id', ParseIntPipe) id: number, @Query('download') download: string | undefined, @Res() res: Response) {
    const { fileName, buffer } = await this.cards.pdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(buffer);
  }

  @Post()
  @RequirePermission('route_cards.create')
  create(@Body(new ZodValidationPipe(routeCardSchema)) body: RouteCardInput, @CurrentActor() actor: Actor) {
    return this.cards.create(body, actor);
  }

  @Put(':id')
  @HttpCode(204)
  @RequirePermission('route_cards.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(routeCardFieldsSchema)) body: RouteCardFieldsInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.cards.update(id, body, actor);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  @RequirePermission('route_cards.update', 'route_cards.delete')
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reasonSchema)) body: ReasonInput, @CurrentActor() actor: Actor) {
    return this.cards.cancel(id, body.reason, actor);
  }

  /** Stage roles are checked in the service (only Forging records forging ...). */
  @Post(':id/operations/:opId')
  @HttpCode(204)
  @RequirePermission('route_card_operations.update')
  record(
    @Param('id', ParseIntPipe) id: number,
    @Param('opId', ParseIntPipe) opId: number,
    @Body(new ZodValidationPipe(operationRecordSchema)) body: OperationRecordInput,
    @CurrentUser() user: AuthUser,
    @CurrentActor() actor: Actor,
  ) {
    return this.cards.recordOperation(id, opId, body, user, actor);
  }

  @Delete(':id/operations/:opId')
  @HttpCode(204)
  @RequirePermission('route_card_operations.update')
  clear(@Param('id', ParseIntPipe) id: number, @Param('opId', ParseIntPipe) opId: number, @CurrentUser() user: AuthUser, @CurrentActor() actor: Actor) {
    return this.cards.clearOperation(id, opId, user, actor);
  }

  @Post(':id/material-requests')
  @RequirePermission('material_requisitions.create')
  requestMaterial(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(materialRequestSchema)) body: MaterialRequestInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.material.request(id, body, actor);
  }

  @Post(':id/material-returns')
  @HttpCode(204)
  @RequirePermission('material_issues.issue')
  returnMaterial(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(materialReturnSchema)) body: MaterialReturnInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.material.returnToStore(id, body, actor);
  }
}

@Controller('material-requests')
export class MaterialRequestsController {
  constructor(private readonly material: MaterialService) {}

  @Get()
  @RequirePermission('material_requisitions.view', 'material_issues.view')
  list(@Query(new ZodValidationPipe(mrQuerySchema)) query: z.infer<typeof mrQuerySchema>) {
    return this.material.list(query, query);
  }

  @Get(':id/heats')
  @RequirePermission('material_issues.issue')
  heats(@Param('id', ParseIntPipe) id: number) {
    return this.material.heats(id);
  }

  @Post(':id/issue')
  @HttpCode(204)
  @RequirePermission('material_issues.issue')
  issue(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(materialIssueSchema)) body: MaterialIssueInput, @CurrentActor() actor: Actor) {
    return this.material.issue(id, body, actor);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  @RequirePermission('material_requisitions.update', 'material_requisitions.delete', 'material_issues.issue')
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.material.cancel(id, actor);
  }

  @Post(':id/purchase-requisition')
  @RequirePermission('purchase_requisitions.create')
  askPurchase(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(mrPurchaseSchema)) body: MrPurchaseInput, @CurrentActor() actor: Actor) {
    return this.material.askPurchase(id, body, actor);
  }
}

@Controller('rc-completions')
export class CompletionsController {
  constructor(private readonly completions: CompletionsService) {}

  @Get()
  @RequirePermission('rc_completions.view', 'route_cards.view')
  list(@Query(new ZodValidationPipe(completionQuerySchema)) query: z.infer<typeof completionQuerySchema>) {
    return this.completions.list(query, query);
  }

  @Post(':id/move')
  @HttpCode(204)
  @RequirePermission('rc_completions.create')
  move(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(completionMoveSchema)) body: CompletionMoveInput, @CurrentActor() actor: Actor) {
    return this.completions.move(id, body, actor);
  }
}
