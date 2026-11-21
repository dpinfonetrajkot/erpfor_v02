import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  LOAN_STATUSES,
  LOAN_TYPE_LABELS,
  listQuerySchema,
  loanRepaymentSchema,
  loanSchema,
  loanUpdateSchema,
  type LoanInput,
  type LoanRepaymentInput,
  type LoanUpdateInput,
} from '@bht/shared';
import { AuditAction, LoanStatus, PaymentMode, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { listArgs, paginated } from '../common/list';
import type { Actor } from '../common/auth-user';
import { dateOf } from './attendance.service';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const loanQuerySchema = listQuerySchema.extend({
  status: z.enum(LOAN_STATUSES).optional(),
  employeeId: z.coerce.number().int().positive().optional(),
});
const include = { employee: { select: { id: true, empCode: true, name: true } } } as const;

/** Salary advances and loans to employees; the EMI is taken in payroll. */
@Controller('loans')
export class LoansController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('loans.view')
  async list(@Query(new ZodValidationPipe(loanQuerySchema)) q: z.infer<typeof loanQuerySchema>) {
    const args = listArgs(
      q,
      { searchFields: ['employee.name', 'employee.empCode', 'reason'], sortable: ['createdAt', 'amount', 'balance', 'startMonth', 'status'], defaultSort: { field: 'createdAt', dir: 'desc' } },
      { ...(q.status ? { status: q.status } : {}), ...(q.employeeId ? { employeeId: q.employeeId } : {}) },
    );
    const [data, total, open] = await this.prisma.$transaction([
      this.prisma.employeeLoan.findMany({ ...args, include }),
      this.prisma.employeeLoan.count({ where: args.where }),
      this.prisma.employeeLoan.aggregate({ where: { status: { not: LoanStatus.CLOSED } }, _sum: { balance: true }, _count: true }),
    ]);
    return { ...paginated(data, total, q), outstanding: n(open._sum.balance), openLoans: open._count };
  }

  @Get(':id')
  @RequirePermission('loans.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.prisma.employeeLoan.findUniqueOrThrow({
      where: { id },
      include: { ...include, repayments: { orderBy: [{ date: 'asc' }, { id: 'asc' }], include: { payslip: { select: { id: true, payrollRun: { select: { month: true } } } } } } },
    });
  }

  @Post()
  @RequirePermission('loans.create')
  async create(@Body(new ZodValidationPipe(loanSchema)) body: LoanInput, @CurrentActor() actor: Actor) {
    const emp = await this.prisma.employee.findUniqueOrThrow({ where: { id: body.employeeId } });
    if (emp.status !== 'ACTIVE') throw new BadRequestException(`${emp.name} has left`);
    const loan = await this.prisma.employeeLoan.create({
      data: {
        employeeId: emp.id,
        type: body.type,
        amount: body.amount,
        emiAmount: body.emiAmount,
        balance: body.amount,
        startMonth: body.startMonth,
        disbursementMode: body.disbursementMode as PaymentMode,
        disbursementRef: body.disbursementRef || null,
        reason: body.reason || null,
        createdById: actor.userId,
      },
      include,
    });
    await this.audit.log(actor, {
      action: AuditAction.CREATE,
      entity: 'loan',
      entityId: loan.id,
      summary: `${LOAN_TYPE_LABELS[body.type]} of ${body.amount} to ${emp.empCode} ${emp.name}, EMI ${body.emiAmount} from ${body.startMonth}`,
    });
    return loan;
  }

  /** EMI and pause / resume; the balance changes only through repayments. */
  @Put(':id')
  @RequirePermission('loans.update')
  async update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(loanUpdateSchema)) body: LoanUpdateInput, @CurrentActor() actor: Actor) {
    const before = await this.prisma.employeeLoan.findUniqueOrThrow({ where: { id }, include });
    if (before.status === LoanStatus.CLOSED) throw new BadRequestException('This loan is closed');
    const loan = await this.prisma.employeeLoan.update({ where: { id }, data: { emiAmount: body.emiAmount, status: body.status as LoanStatus, reason: body.reason || before.reason }, include });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'loan',
      entityId: id,
      summary: `Loan of ${loan.employee.empCode} ${loan.employee.name}: EMI ${n(before.emiAmount)} -> ${body.emiAmount}, ${before.status} -> ${body.status}`,
    });
    return loan;
  }

  /** Money paid back outside payroll (cash / bank). */
  @Post(':id/repayments')
  @RequirePermission('loans.update')
  repay(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(loanRepaymentSchema)) body: LoanRepaymentInput, @CurrentActor() actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const loan = await tx.employeeLoan.findUniqueOrThrow({ where: { id }, include });
      if (loan.status === LoanStatus.CLOSED) throw new BadRequestException('This loan is already closed');
      if (body.amount > n(loan.balance) + 0.005) throw new BadRequestException({ message: `Only ${n(loan.balance)} is still due`, errors: { amount: `At most ${n(loan.balance)}` } });
      const balance = r2(n(loan.balance) - body.amount);
      await tx.loanRepayment.create({ data: { loanId: id, date: dateOf(body.date), amount: body.amount, mode: body.mode as PaymentMode, remarks: body.remarks || null, createdById: actor.userId } });
      await tx.employeeLoan.update({ where: { id }, data: { balance, ...(balance <= 0 ? { status: LoanStatus.CLOSED } : {}) } });
      await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'loan', entityId: id, summary: `${body.amount} paid back by ${loan.employee.empCode} ${loan.employee.name} (${body.mode}); balance ${balance}` }, tx);
      return { balance, closed: balance <= 0 };
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('loans.delete')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    const loan = await this.prisma.employeeLoan.findUniqueOrThrow({ where: { id }, include: { ...include, _count: { select: { repayments: true } } } });
    if (loan._count.repayments) throw new BadRequestException('Repayments are recorded on this loan; it cannot be deleted');
    await this.prisma.employeeLoan.delete({ where: { id } });
    await this.audit.log(actor, { action: AuditAction.DELETE, entity: 'loan', entityId: id, summary: `Deleted loan of ${loan.employee.empCode} ${loan.employee.name} (${n(loan.amount)})` });
  }
}
