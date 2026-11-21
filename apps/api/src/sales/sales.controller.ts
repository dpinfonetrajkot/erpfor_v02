import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  APPROVAL_STAGE_PERMISSION,
  APPROVAL_STAGES,
  approvalDecisionSchema,
  hasPermission,
  listQuerySchema,
  mtsRequestSchema,
  PRODUCTION_REQUEST_STATUSES,
  reasonSchema,
  salesOrderSchema,
  SO_STATUSES,
  soProductionRequestSchema,
  type ApprovalDecisionInput,
  type MtsRequestInput,
  type ReasonInput,
  type SalesOrderInput,
  type SoProductionRequestInput,
} from '@bht/shared';
import { ApprovalStage } from '../generated/prisma/client';
import { CurrentActor, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor, AuthUser } from '../common/auth-user';
import { ProductionRequestsService } from './production-requests.service';
import { SalesOrdersService } from './sales-orders.service';

const SO_READERS = ['sales_orders.view', 'so_feasibility.approve', 'so_design.approve', 'so_production.approve', 'stock_check.view'];

const soQuerySchema = listQuerySchema.extend({
  status: z.enum([...SO_STATUSES, 'OPEN']).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  awaiting: z.enum(APPROVAL_STAGES).optional(),
});
const checkPoSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  poNo: z.string().trim().min(1).max(100),
  excludeId: z.coerce.number().int().positive().optional(),
});
const stageSchema = z.enum(APPROVAL_STAGES);
const prQuerySchema = listQuerySchema.extend({
  status: z.enum(PRODUCTION_REQUEST_STATUSES).optional(),
  type: z.enum(['MAKE_TO_ORDER', 'MAKE_TO_STOCK']).optional(),
  salesOrderId: z.coerce.number().int().positive().optional(),
});

@Controller('sales-orders')
export class SalesOrdersController {
  constructor(private readonly orders: SalesOrdersService) {}

  @Get()
  @RequirePermission(...SO_READERS)
  list(@Query(new ZodValidationPipe(soQuerySchema)) query: z.infer<typeof soQuerySchema>) {
    return this.orders.list(query, query);
  }

  @Get('check-po')
  @RequirePermission('sales_orders.create', 'sales_orders.update')
  checkPo(@Query(new ZodValidationPipe(checkPoSchema)) q: z.infer<typeof checkPoSchema>) {
    return this.orders.checkPo(q.customerId, q.poNo, q.excludeId);
  }

  @Get(':id')
  @RequirePermission(...SO_READERS)
  get(@Param('id', ParseIntPipe) id: number) {
    return this.orders.get(id);
  }

  @Post()
  @RequirePermission('sales_orders.create')
  create(@Body(new ZodValidationPipe(salesOrderSchema)) body: SalesOrderInput, @CurrentActor() actor: Actor) {
    return this.orders.create(body, actor);
  }

  @Put(':id')
  @RequirePermission('sales_orders.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(salesOrderSchema)) body: SalesOrderInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.orders.update(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('sales_orders.delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.orders.remove(id, actor);
  }

  @Post(':id/submit')
  @RequirePermission('sales_orders.create', 'sales_orders.update')
  submit(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.orders.submit(id, actor);
  }

  /** Each stage needs its own permission (feasibility / design / production). */
  @Post(':id/approvals/:stage')
  @RequirePermission('so_feasibility.approve', 'so_design.approve', 'so_production.approve')
  decide(
    @Param('id', ParseIntPipe) id: number,
    @Param('stage', new ZodValidationPipe(stageSchema)) stage: z.infer<typeof stageSchema>,
    @Body(new ZodValidationPipe(approvalDecisionSchema)) body: ApprovalDecisionInput,
    @CurrentUser() user: AuthUser,
    @CurrentActor() actor: Actor,
  ) {
    if (!hasPermission(user.permissions, APPROVAL_STAGE_PERMISSION[stage])) {
      throw new ForbiddenException(`You cannot decide the ${stage.toLowerCase()} stage`);
    }
    return this.orders.decide(id, stage as ApprovalStage, body, actor);
  }

  @Post(':id/reopen')
  @RequirePermission('sales_orders.update')
  reopen(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.orders.reopen(id, actor);
  }

  @Post(':id/cancel')
  @RequirePermission('sales_orders.update')
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reasonSchema)) body: ReasonInput, @CurrentActor() actor: Actor) {
    return this.orders.cancel(id, body.reason, actor);
  }

  @Get(':id/stock-check')
  @RequirePermission('stock_check.view', 'sales_orders.view')
  stockCheck(@Param('id', ParseIntPipe) id: number) {
    return this.orders.stockCheck(id);
  }

  @Post(':id/production-requests')
  @RequirePermission('stock_check.create')
  requestProduction(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(soProductionRequestSchema)) body: SoProductionRequestInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.orders.requestProduction(id, body, actor);
  }
}

@Controller('production-requests')
export class ProductionRequestsController {
  constructor(private readonly requests: ProductionRequestsService) {}

  @Get()
  @RequirePermission('stock_check.view', 'route_cards.view')
  list(@Query(new ZodValidationPipe(prQuerySchema)) query: z.infer<typeof prQuerySchema>) {
    return this.requests.list(query, query);
  }

  @Post()
  @RequirePermission('stock_check.create')
  createMts(@Body(new ZodValidationPipe(mtsRequestSchema)) body: MtsRequestInput, @CurrentActor() actor: Actor) {
    return this.requests.createMts(body, actor);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  @RequirePermission('stock_check.create')
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reasonSchema)) body: ReasonInput, @CurrentActor() actor: Actor) {
    return this.requests.cancel(id, body.reason, actor);
  }
}
