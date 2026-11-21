import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  hasPermission,
  LEAVE_STATUSES,
  LEAVE_TYPE_LABELS,
  LEAVE_TYPES,
  leaveBalanceSchema,
  leaveDays,
  leaveDecisionSchema,
  leaveSchema,
  listQuerySchema,
  PAID_LEAVE_TYPES,
  reasonSchema,
  type LeaveBalanceInput,
  type LeaveDecisionInput,
  type LeaveInput,
  type ReasonInput,
} from '@bht/shared';
import { AuditAction, LeaveStatus, LeaveType, Prisma } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NotificationsService } from '../core/notifications.service';
import { CurrentActor, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { listArgs, paginated } from '../common/list';
import type { Actor, AuthUser } from '../common/auth-user';
import { codeOrder, dateOf, ymdOf } from './attendance.service';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const leaveQuerySchema = listQuerySchema.extend({
  status: z.enum(LEAVE_STATUSES).optional(),
  type: z.enum(LEAVE_TYPES).optional(),
  employeeId: z.coerce.number().int().positive().optional(),
});
const yearSchema = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
const include = { employee: { select: { id: true, empCode: true, name: true } } } as const;
const QUOTA_FIELD = { CL: 'casual', SL: 'sick', EL: 'earned' } as const;

@Controller('leaves')
export class LeavesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @RequirePermission('leaves.view')
  async list(@Query(new ZodValidationPipe(leaveQuerySchema)) q: z.infer<typeof leaveQuerySchema>) {
    const args = listArgs(
      q,
      { searchFields: ['employee.name', 'employee.empCode', 'reason'], sortable: ['fromDate', 'createdAt', 'days', 'status'], defaultSort: { field: 'fromDate', dir: 'desc' } },
      {
        ...(q.status ? { status: q.status } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      },
    );
    const [data, total] = await this.prisma.$transaction([this.prisma.leaveRequest.findMany({ ...args, include }), this.prisma.leaveRequest.count({ where: args.where })]);
    return paginated(data, total, q);
  }

  @Post()
  @RequirePermission('leaves.create')
  async create(@Body(new ZodValidationPipe(leaveSchema)) body: LeaveInput, @CurrentUser() user: AuthUser, @CurrentActor() actor: Actor) {
    if (body.approveNow && !hasPermission(user.permissions, 'leaves.approve')) throw new ForbiddenException('You may record leave, not approve it');
    const emp = await this.prisma.employee.findUniqueOrThrow({ where: { id: body.employeeId } });
    if (emp.status !== 'ACTIVE') throw new BadRequestException(`${emp.name} has left`);
    const days = leaveDays(body.fromDate, body.toDate, body.isHalfDay);
    const created = await this.prisma.$transaction(async (tx) => {
      const overlap = await tx.leaveRequest.findFirst({
        where: { employeeId: emp.id, status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] }, fromDate: { lte: dateOf(body.toDate) }, toDate: { gte: dateOf(body.fromDate) } },
      });
      if (overlap) throw new BadRequestException(`${emp.name} already has leave from ${ymdOf(overlap.fromDate)} to ${ymdOf(overlap.toDate)}`);
      const leave = await tx.leaveRequest.create({
        data: {
          employeeId: emp.id,
          type: body.type as LeaveType,
          fromDate: dateOf(body.fromDate),
          toDate: dateOf(body.toDate),
          isHalfDay: body.isHalfDay,
          days,
          reason: body.reason,
          createdById: actor.userId,
          ...(body.approveNow ? { status: LeaveStatus.APPROVED, decidedById: actor.userId, decidedAt: new Date() } : {}),
        },
        include,
      });
      if (body.approveNow) await this.checkApprovable(tx, leave);
      await this.audit.log(
        actor,
        {
          action: AuditAction.CREATE,
          entity: 'leave',
          entityId: leave.id,
          summary: `${LEAVE_TYPE_LABELS[body.type]} for ${emp.empCode} ${emp.name}: ${days} day(s) from ${body.fromDate}${body.approveNow ? ' (approved)' : ''}`,
        },
        tx,
      );
      return leave;
    });
    if (!body.approveNow) {
      await this.notifications.toPermission('leaves.approve', { title: `Leave of ${emp.name} waits for approval`, body: `${LEAVE_TYPE_LABELS[body.type]}, ${days} day(s) from ${body.fromDate}`, link: '/hr/leaves?status=PENDING' }, actor.userId);
    }
    return created;
  }

  /** Approved leave must fit the yearly balance and must not fall in a month whose payroll is closed. */
  private async checkApprovable(tx: Tx, leave: { id: number; employeeId: number; type: LeaveType; fromDate: Date; toDate: Date; days: Prisma.Decimal }) {
    const locks = await tx.attendanceLock.count({ where: { date: { gte: leave.fromDate, lte: leave.toDate } } });
    if (locks) throw new BadRequestException('These dates are in a month whose payroll is finalized; revoke that payroll first');
    if (!PAID_LEAVE_TYPES.includes(leave.type)) return;
    const year = leave.fromDate.getUTCFullYear();
    const quota = await tx.leaveBalance.findUnique({ where: { employeeId_year: { employeeId: leave.employeeId, year } } });
    const allowed = n(quota?.[QUOTA_FIELD[leave.type as 'CL' | 'SL' | 'EL']]);
    const used = await tx.leaveRequest.aggregate({
      where: { employeeId: leave.employeeId, type: leave.type, status: LeaveStatus.APPROVED, fromDate: { gte: new Date(`${year}-01-01T00:00:00Z`), lte: new Date(`${year}-12-31T00:00:00Z`) } },
      _sum: { days: true },
    });
    // "used" already counts this leave when it was saved as approved
    if (n(used._sum.days) > allowed) {
      throw new BadRequestException(`Not enough ${LEAVE_TYPE_LABELS[leave.type]} left for ${year}: ${allowed} allowed, this makes ${n(used._sum.days)}. Use Leave without pay or raise the balance.`);
    }
  }

  @Post(':id/decide')
  @RequirePermission('leaves.approve')
  decide(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(leaveDecisionSchema)) body: LeaveDecisionInput, @CurrentActor() actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.leaveRequest.findUniqueOrThrow({ where: { id }, include });
      if (before.status !== LeaveStatus.PENDING) throw new BadRequestException('Only waiting leave can be approved or rejected');
      const leave = await tx.leaveRequest.update({
        where: { id },
        data: { status: body.decision as LeaveStatus, adminRemark: body.remark || null, decidedById: actor.userId, decidedAt: new Date() },
        include,
      });
      if (body.decision === 'APPROVED') await this.checkApprovable(tx, leave);
      await this.audit.log(
        actor,
        { action: AuditAction.STATUS_CHANGE, entity: 'leave', entityId: id, summary: `${body.decision === 'APPROVED' ? 'Approved' : 'Rejected'} ${LEAVE_TYPE_LABELS[leave.type]} of ${leave.employee.empCode} ${leave.employee.name} (${ymdOf(leave.fromDate)})` },
        tx,
      );
      return leave;
    });
  }

  @Post(':id/cancel')
  @RequirePermission('leaves.update', 'leaves.approve')
  async cancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reasonSchema)) body: ReasonInput, @CurrentActor() actor: Actor) {
    const leave = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id }, include });
    if (leave.status !== LeaveStatus.PENDING && leave.status !== LeaveStatus.APPROVED) throw new BadRequestException('This leave is already closed');
    if (leave.status === LeaveStatus.APPROVED && (await this.prisma.attendanceLock.count({ where: { date: { gte: leave.fromDate, lte: leave.toDate } } }))) {
      throw new BadRequestException('Paid in a finalized payroll; revoke that payroll first');
    }
    await this.prisma.leaveRequest.update({ where: { id }, data: { status: LeaveStatus.CANCELLED, adminRemark: body.reason } });
    await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'leave', entityId: id, summary: `Cancelled ${LEAVE_TYPE_LABELS[leave.type]} of ${leave.employee.empCode} ${leave.employee.name}: ${body.reason}` });
    return { ok: true };
  }

  /** Every working employee: leave allowed this year, used, waiting and left. */
  @Get('balances')
  @RequirePermission('leaves.view')
  async balances(@Query(new ZodValidationPipe(yearSchema)) q: z.infer<typeof yearSchema>) {
    const [employees, quotas, taken] = await Promise.all([
      this.prisma.employee.findMany({ where: { status: 'ACTIVE' }, select: { id: true, empCode: true, name: true } }),
      this.prisma.leaveBalance.findMany({ where: { year: q.year } }),
      this.prisma.leaveRequest.groupBy({
        by: ['employeeId', 'type', 'status'],
        where: { status: { in: [LeaveStatus.APPROVED, LeaveStatus.PENDING] }, fromDate: { gte: new Date(`${q.year}-01-01T00:00:00Z`), lte: new Date(`${q.year}-12-31T00:00:00Z`) } },
        _sum: { days: true },
      }),
    ]);
    return employees
      .sort((a, b) => codeOrder(a.empCode, b.empCode))
      .map((e) => {
        const quota = quotas.find((x) => x.employeeId === e.id);
        const sum = (type: string, status: LeaveStatus) => n(taken.find((t) => t.employeeId === e.id && t.type === type && t.status === status)?._sum.days);
        const kind = (type: 'CL' | 'SL' | 'EL') => {
          const allowed = n(quota?.[QUOTA_FIELD[type]]);
          const used = sum(type, LeaveStatus.APPROVED);
          return { allowed, used, waiting: sum(type, LeaveStatus.PENDING), left: Math.round((allowed - used) * 10) / 10 };
        };
        return { employee: e, CL: kind('CL'), SL: kind('SL'), EL: kind('EL'), LWP: { used: sum('LWP', LeaveStatus.APPROVED), waiting: sum('LWP', LeaveStatus.PENDING) } };
      });
  }

  /** Sets the yearly allowance for the chosen (or all working) employees. */
  @Put('balances')
  @RequirePermission('leaves.approve')
  async setBalances(@Body(new ZodValidationPipe(leaveBalanceSchema)) body: LeaveBalanceInput, @CurrentActor() actor: Actor) {
    const ids = body.employeeIds?.length
      ? body.employeeIds
      : (await this.prisma.employee.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })).map((e) => e.id);
    const data = { casual: body.casual, sick: body.sick, earned: body.earned };
    await this.prisma.$transaction(
      ids.map((employeeId) => this.prisma.leaveBalance.upsert({ where: { employeeId_year: { employeeId, year: body.year } }, create: { employeeId, year: body.year, ...data }, update: data })),
    );
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'leave_balance',
      summary: `Leave allowance ${body.year} for ${ids.length} employee(s): CL ${body.casual}, SL ${body.sick}, EL ${body.earned}`,
    });
    return { updated: ids.length };
  }
}
