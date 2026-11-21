import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  COMPANY_ASSET_STATUSES,
  companyAssetSchema,
  inspectionSchema,
  listQuerySchema,
  safetyAssetSchema,
  type CompanyAssetInput,
  type InspectionInput,
  type SafetyAssetInput,
} from '@bht/shared';
import { AuditAction } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { listArgs, paginated } from '../common/list';
import { diff, normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';
import { dateOf, todayIst } from './attendance.service';

const companyQuery = listQuerySchema.extend({ status: z.enum(COMPANY_ASSET_STATUSES).optional(), employeeId: z.coerce.number().int().positive().optional() });
const safetyQuery = listQuerySchema.extend({ due: z.enum(['true']).optional() });
const include = { employee: { select: { id: true, empCode: true, name: true } } } as const;
/** Safety items due for inspection within this many days show as "due soon". */
export const SAFETY_DUE_DAYS = 15;

@Controller('company-assets')
export class CompanyAssetsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('assets.view')
  async list(@Query(new ZodValidationPipe(companyQuery)) q: z.infer<typeof companyQuery>) {
    const args = listArgs(
      q,
      { searchFields: ['code', 'name', 'category', 'department', 'employee.name'], sortable: ['code', 'name', 'category', 'status', 'assignDate', 'warrantyDate'], defaultSort: { field: 'code', dir: 'asc' } },
      { ...(q.status ? { status: q.status } : {}), ...(q.employeeId ? { employeeId: q.employeeId } : {}) },
    );
    const [data, total] = await this.prisma.$transaction([this.prisma.companyAsset.findMany({ ...args, include }), this.prisma.companyAsset.count({ where: args.where })]);
    return paginated(data, total, q);
  }

  @Post()
  @RequirePermission('assets.create')
  async create(@Body(new ZodValidationPipe(companyAssetSchema)) body: CompanyAssetInput, @CurrentActor() actor: Actor) {
    const a = await this.prisma.companyAsset.create({ data: { ...normalize(body), code: body.code.toUpperCase() }, include });
    await this.audit.log(actor, { action: AuditAction.CREATE, entity: 'company_asset', entityId: a.id, summary: `Added asset ${a.code} ${a.name}${a.employee ? ` with ${a.employee.name}` : ''}` });
    return a;
  }

  @Put(':id')
  @RequirePermission('assets.update')
  async update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(companyAssetSchema)) body: CompanyAssetInput, @CurrentActor() actor: Actor) {
    const before = await this.prisma.companyAsset.findUniqueOrThrow({ where: { id }, include });
    const a = await this.prisma.companyAsset.update({ where: { id }, data: { ...normalize(body), code: body.code.toUpperCase() }, include });
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'company_asset', entityId: id, summary: `Updated asset ${a.code}`, changes: diff(before, a) });
    return a;
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('assets.delete')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    const a = await this.prisma.companyAsset.delete({ where: { id } });
    await this.audit.log(actor, { action: AuditAction.DELETE, entity: 'company_asset', entityId: id, summary: `Deleted asset ${a.code} ${a.name}` });
  }
}

@Controller('safety-assets')
export class SafetyAssetsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('assets.view')
  async list(@Query(new ZodValidationPipe(safetyQuery)) q: z.infer<typeof safetyQuery>) {
    const soon = dateOf(todayIst());
    soon.setUTCDate(soon.getUTCDate() + SAFETY_DUE_DAYS);
    const args = listArgs(
      q,
      { searchFields: ['code', 'name', 'locationZone', 'typeCapacity', 'vendorAgency'], sortable: ['code', 'name', 'nextDueDate', 'lastInspectionDate', 'status'], defaultSort: { field: 'nextDueDate', dir: 'asc' } },
      q.due ? { OR: [{ nextDueDate: { lte: soon } }, { status: { not: 'OK' } }] } : {},
    );
    const [data, total] = await this.prisma.$transaction([this.prisma.safetyAsset.findMany(args), this.prisma.safetyAsset.count({ where: args.where })]);
    return { ...paginated(data, total, q), dueWithinDays: SAFETY_DUE_DAYS };
  }

  @Post()
  @RequirePermission('assets.create')
  async create(@Body(new ZodValidationPipe(safetyAssetSchema)) body: SafetyAssetInput, @CurrentActor() actor: Actor) {
    const a = await this.prisma.safetyAsset.create({ data: { ...normalize(body), code: body.code.toUpperCase() } });
    await this.audit.log(actor, { action: AuditAction.CREATE, entity: 'safety_asset', entityId: a.id, summary: `Added safety item ${a.code} ${a.name}` });
    return a;
  }

  @Put(':id')
  @RequirePermission('assets.update')
  async update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(safetyAssetSchema)) body: SafetyAssetInput, @CurrentActor() actor: Actor) {
    const before = await this.prisma.safetyAsset.findUniqueOrThrow({ where: { id } });
    const a = await this.prisma.safetyAsset.update({ where: { id }, data: { ...normalize(body), code: body.code.toUpperCase() } });
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'safety_asset', entityId: id, summary: `Updated safety item ${a.code}`, changes: diff(before, a) });
    return a;
  }

  /** Inspection done: next due = given date, or inspection date + the item's interval. */
  @Post(':id/inspection')
  @RequirePermission('assets.update')
  async inspect(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(inspectionSchema)) body: InspectionInput, @CurrentActor() actor: Actor) {
    const a = await this.prisma.safetyAsset.findUniqueOrThrow({ where: { id } });
    let next: Date | null = body.nextDueDate ? dateOf(body.nextDueDate) : null;
    if (!next && a.inspectionIntervalDays) {
      next = dateOf(body.date);
      next.setUTCDate(next.getUTCDate() + a.inspectionIntervalDays);
    }
    const updated = await this.prisma.safetyAsset.update({
      where: { id },
      data: { lastInspectionDate: dateOf(body.date), nextDueDate: next, status: body.status, remarks: body.remarks || a.remarks },
    });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'safety_asset',
      entityId: id,
      summary: `Inspected ${a.code} ${a.name} on ${body.date}: ${body.status}${next ? `, next due ${next.toISOString().slice(0, 10)}` : ''}`,
    });
    return updated;
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('assets.delete')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    const a = await this.prisma.safetyAsset.delete({ where: { id } });
    await this.audit.log(actor, { action: AuditAction.DELETE, entity: 'safety_asset', entityId: id, summary: `Deleted safety item ${a.code} ${a.name}` });
  }
}
