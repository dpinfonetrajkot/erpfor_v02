import { BadRequestException, Injectable } from '@nestjs/common';
import {
  computeSalary,
  DEFAULT_PAYROLL_SETTINGS,
  isSunday,
  monthDates,
  PAID_LEAVE_TYPES,
  type PayrollAdjustInput,
  type PayrollPaidInput,
  type PayrollSettingsInput,
} from '@bht/shared';
import { AuditAction, LoanStatus, PayrollStatus, Prisma } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NotificationsService } from '../core/notifications.service';
import type { Actor } from '../common/auth-user';
import { codeOrder, dateOf, leaveByDate, todayIst, ymdOf } from './attendance.service';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const SETTING = { monthDays: 'payroll.month_days', pfPercent: 'payroll.pf_percent' } as const;

export const payslipInclude = {
  employee: {
    select: {
      id: true, empCode: true, name: true, designation: true, dateOfJoining: true, uan: true, bankName: true, bankAccountNo: true, bankIfsc: true,
      department: { select: { name: true } },
    },
  },
  loanRepayments: { select: { amount: true, loan: { select: { id: true, type: true, balance: true } } } },
} as const;
export type PayslipFull = Prisma.PayslipGetPayload<{ include: typeof payslipInclude }>;

/** Monthly salary from attendance, approved leave and running loans (formula in @bht/shared computeSalary). */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async settings(): Promise<PayrollSettingsInput> {
    const rows = await this.prisma.appSetting.findMany({ where: { key: { in: Object.values(SETTING) } } });
    const get = (k: string, d: number) => {
      const v = Number(rows.find((r) => r.key === k)?.value);
      return Number.isFinite(v) && rows.some((r) => r.key === k) ? v : d;
    };
    return { monthDays: get(SETTING.monthDays, DEFAULT_PAYROLL_SETTINGS.monthDays), pfPercent: get(SETTING.pfPercent, DEFAULT_PAYROLL_SETTINGS.pfPercent) };
  }

  async saveSettings(input: PayrollSettingsInput, actor: Actor) {
    await this.prisma.$transaction(
      (Object.keys(SETTING) as (keyof typeof SETTING)[]).map((k) =>
        this.prisma.appSetting.upsert({ where: { key: SETTING[k] }, create: { key: SETTING[k], value: String(input[k]) }, update: { value: String(input[k]) } }),
      ),
    );
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'payroll_settings', summary: `Payroll settings: ${input.monthDays} days a month, PF ${input.pfPercent}%` });
    return input;
  }

  list() {
    return this.prisma.payrollRun
      .findMany({ orderBy: { month: 'desc' }, include: { _count: { select: { payslips: true } } } })
      .then(async (runs) => {
        const sums = await this.prisma.payslip.groupBy({ by: ['payrollRunId'], _sum: { netSalary: true, grossEarning: true } });
        return runs.map((r) => {
          const s = sums.find((x) => x.payrollRunId === r.id);
          return { ...r, employees: r._count.payslips, gross: n(s?._sum.grossEarning), net: n(s?._sum.netSalary) };
        });
      });
  }

  async month(month: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { month }, include: { payslips: { include: payslipInclude } } });
    if (!run) {
      const dates = monthDates(month);
      const candidates = await this.prisma.attendance.groupBy({ by: ['employeeId'], where: { date: { gte: dateOf(dates[0]), lte: dateOf(dates[dates.length - 1]) } } });
      return { month, run: null, candidates: candidates.length, settings: await this.settings() };
    }
    const payslips = run.payslips.sort((a, b) => codeOrder(a.employee.empCode, b.employee.empCode));
    const sum = (f: (p: (typeof payslips)[number]) => Prisma.Decimal | number) => r2(payslips.reduce((s, p) => s + n(f(p)), 0));
    return {
      month,
      run: { ...run, payslips: undefined },
      payslips,
      totals: {
        employees: payslips.length,
        gross: sum((p) => p.grossEarning),
        pf: sum((p) => p.pfDeduction),
        loans: sum((p) => p.loanDeduction),
        other: sum((p) => p.otherAdjustment),
        net: sum((p) => p.netSalary),
      },
      settings: await this.settings(),
    };
  }

  /** Salary inputs of everyone who worked or had paid leave in the month. */
  private async inputs(tx: Tx, month: string, monthDays: number, pfPercent: number) {
    const dates = monthDates(month);
    const from = dates[0];
    const to = dates[dates.length - 1];
    const [days, leaves] = await Promise.all([
      tx.attendance.findMany({ where: { date: { gte: dateOf(from), lte: dateOf(to) } } }),
      tx.leaveRequest.findMany({ where: { status: 'APPROVED', type: { in: PAID_LEAVE_TYPES }, fromDate: { lte: dateOf(to) }, toDate: { gte: dateOf(from) } } }),
    ]);
    const ids = [...new Set([...days.map((d) => d.employeeId), ...leaves.map((l) => l.employeeId)])];
    const [employees, loans] = await Promise.all([
      tx.employee.findMany({ where: { id: { in: ids } } }),
      tx.employeeLoan.findMany({ where: { employeeId: { in: ids }, status: LoanStatus.ACTIVE, startMonth: { lte: month } }, orderBy: [{ startMonth: 'asc' }, { id: 'asc' }] }),
    ]);
    return employees
      .map((e) => {
        const mine = days.filter((d) => d.employeeId === e.id && ((d.punches as string[] | null) ?? []).length > 0);
        const weekdays = mine.filter((d) => !isSunday(ymdOf(d.date)));
        const worked = new Set(weekdays.map((d) => ymdOf(d.date)));
        const leave = leaveByDate(leaves.filter((l) => l.employeeId === e.id), from, to);
        const paidLeaveDays = [...leave.entries()].filter(([date]) => !worked.has(date)).reduce((s, [, l]) => s + l.days, 0);
        return {
          employee: e,
          sundaysWorked: mine.length - weekdays.length,
          input: {
            basicSalary: n(e.basicSalary),
            monthDays,
            shiftHours: n(e.shiftHours) || 8,
            presentDays: weekdays.length,
            paidLeaveDays,
            hoursWorked: r2(weekdays.reduce((s, d) => s + n(d.hoursWorked), 0)),
            isPfEligible: e.isPfEligible,
            pfPercent,
            loans: loans.filter((l) => l.employeeId === e.id).map((l) => ({ loanId: l.id, emi: n(l.emiAmount), balance: n(l.balance) })),
          },
        };
      })
      .filter((x) => x.input.presentDays > 0 || x.input.paidLeaveDays > 0);
  }

  /**
   * (Re)calculates the payslips of a draft in place (same ids, so links keep working); HR's own +/- amounts
   * are kept, new people are added, people with nothing left in the month are removed.
   */
  private async build(tx: Tx, run: { id: number; month: string; monthDays: number; pfPercent: Prisma.Decimal }) {
    const old = await tx.payslip.findMany({ where: { payrollRunId: run.id }, select: { id: true, employeeId: true, otherAdjustment: true, adjustmentNote: true } });
    const keep = new Map(old.map((o) => [o.employeeId, o]));
    const rows = await this.inputs(tx, run.month, run.monthDays, n(run.pfPercent));
    await tx.payslip.deleteMany({ where: { payrollRunId: run.id, employeeId: { notIn: rows.map((r) => r.employee.id) } } });
    const results = [];
    for (const r of rows) {
      const adj = keep.get(r.employee.id);
      const s = computeSalary({ ...r.input, otherAdjustment: n(adj?.otherAdjustment) });
      const payslip = await tx.payslip.upsert({
        where: { payrollRunId_employeeId: { payrollRunId: run.id, employeeId: r.employee.id } },
        update: {
          basicSalary: r.input.basicSalary,
          shiftHours: r.input.shiftHours,
          isPfEligible: r.input.isPfEligible,
          presentDays: s.presentDays,
          paidLeaveDays: s.paidLeaveDays,
          payableDays: s.payableDays,
          absentDays: s.absentDays,
          sundaysWorked: r.sundaysWorked,
          hoursWorked: r.input.hoursWorked,
          expectedHours: s.expectedHours,
          hourDifference: s.hourDifference,
          baseEarning: s.baseEarning,
          hourAdjustment: s.hourAdjustment,
          grossEarning: s.grossEarning,
          pfDeduction: s.pfDeduction,
          loanDeduction: s.loanDeduction,
          roundOff: s.roundOff,
          netSalary: s.netSalary,
        },
        create: {
          payrollRunId: run.id,
          employeeId: r.employee.id,
          basicSalary: r.input.basicSalary,
          shiftHours: r.input.shiftHours,
          isPfEligible: r.input.isPfEligible,
          presentDays: s.presentDays,
          paidLeaveDays: s.paidLeaveDays,
          payableDays: s.payableDays,
          absentDays: s.absentDays,
          sundaysWorked: r.sundaysWorked,
          hoursWorked: r.input.hoursWorked,
          expectedHours: s.expectedHours,
          hourDifference: s.hourDifference,
          baseEarning: s.baseEarning,
          hourAdjustment: s.hourAdjustment,
          grossEarning: s.grossEarning,
          pfDeduction: s.pfDeduction,
          loanDeduction: s.loanDeduction,
          otherAdjustment: n(adj?.otherAdjustment),
          adjustmentNote: adj?.adjustmentNote ?? null,
          roundOff: s.roundOff,
          netSalary: s.netSalary,
        },
      });
      results.push({ payslip, loanDeductions: s.loanDeductions });
    }
    return results;
  }

  async prepare(month: string, actor: Actor) {
    if (month > todayIst().slice(0, 7)) throw new BadRequestException('That month has not started yet');
    if (await this.prisma.payrollRun.findUnique({ where: { month } })) throw new BadRequestException(`Payroll for ${month} is already prepared`);
    const settings = await this.settings();
    const prepared = await this.prisma.$transaction(
      async (tx) => {
        const run = await tx.payrollRun.create({ data: { month, monthDays: settings.monthDays, pfPercent: settings.pfPercent, createdById: actor.userId } });
        const slips = await this.build(tx, run);
        if (!slips.length) throw new BadRequestException(`No attendance or paid leave in ${month}`);
        await this.audit.log(actor, { action: AuditAction.CREATE, entity: 'payroll', entityId: run.id, summary: `Prepared payroll ${month} for ${slips.length} employee(s)` }, tx);
        return { id: run.id, employees: slips.length };
      },
      { timeout: 60_000 },
    );
    await this.notifications.toPermission('payroll.approve', { title: `Payroll ${month} prepared - check and finalize`, body: `${prepared.employees} employee(s)`, link: `/hr/payroll?month=${month}` }, actor.userId);
    return prepared;
  }

  private async draft(tx: Tx | PrismaService, month: string) {
    const run = await tx.payrollRun.findUnique({ where: { month } });
    if (!run) throw new BadRequestException(`Payroll for ${month} is not prepared`);
    if (run.status !== PayrollStatus.DRAFT) throw new BadRequestException(`Payroll for ${month} is ${run.status.toLowerCase()}; revoke it first`);
    return run;
  }

  /** Picks up attendance, leave and loan changes made since the draft was prepared. */
  recalculate(month: string, actor: Actor) {
    return this.prisma.$transaction(
      async (tx) => {
        const run = await this.draft(tx, month);
        const slips = await this.build(tx, run);
        await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'payroll', entityId: run.id, summary: `Recalculated payroll ${month} (${slips.length} employees)` }, tx);
        return { employees: slips.length };
      },
      { timeout: 60_000 },
    );
  }

  /** HR's own amount on one payslip (+ bonus / Sunday work, - fine ...). */
  adjust(payslipId: number, input: PayrollAdjustInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.payslip.findUniqueOrThrow({ where: { id: payslipId }, include: { payrollRun: true, employee: { select: { empCode: true, name: true } } } });
      const run = await this.draft(tx, p.payrollRun.month);
      await tx.payslip.update({ where: { id: p.id }, data: { otherAdjustment: input.otherAdjustment, adjustmentNote: input.adjustmentNote || null } });
      // recompute this employee with the new amount (loan EMIs may change if pay is short)
      const rows = await this.inputs(tx, run.month, run.monthDays, n(run.pfPercent));
      const r = rows.find((x) => x.employee.id === p.employeeId);
      if (r) {
        const s = computeSalary({ ...r.input, otherAdjustment: input.otherAdjustment });
        await tx.payslip.update({ where: { id: p.id }, data: { loanDeduction: s.loanDeduction, roundOff: s.roundOff, netSalary: s.netSalary } });
      }
      await this.audit.log(
        actor,
        { action: AuditAction.UPDATE, entity: 'payslip', entityId: p.id, summary: `Payroll ${run.month}, ${p.employee.empCode} ${p.employee.name}: adjustment ${input.otherAdjustment}${input.adjustmentNote ? ` (${input.adjustmentNote})` : ''}` },
        tx,
      );
      return tx.payslip.findUniqueOrThrow({ where: { id: p.id }, include: payslipInclude });
    });
  }

  /** Recalculates once more, books the loan EMIs and closes the month's attendance. */
  finalize(month: string, actor: Actor) {
    return this.prisma.$transaction(
      async (tx) => {
        const run = await this.draft(tx, month);
        const slips = await this.build(tx, run);
        const lastDay = monthDates(month).at(-1)!;
        let loanTotal = 0;
        for (const { payslip, loanDeductions } of slips) {
          for (const d of loanDeductions) {
            const loan = await tx.employeeLoan.findUniqueOrThrow({ where: { id: d.loanId } });
            const balance = r2(n(loan.balance) - d.amount);
            await tx.loanRepayment.create({ data: { loanId: d.loanId, payslipId: payslip.id, date: dateOf(lastDay), amount: d.amount, remarks: `Salary ${month}`, createdById: actor.userId } });
            await tx.employeeLoan.update({ where: { id: d.loanId }, data: { balance, ...(balance <= 0 ? { status: LoanStatus.CLOSED } : {}) } });
            loanTotal += d.amount;
          }
        }
        await tx.attendanceLock.createMany({ data: monthDates(month).map((d) => ({ date: dateOf(d), lockedById: actor.userId })), skipDuplicates: true });
        await tx.payrollRun.update({ where: { id: run.id }, data: { status: PayrollStatus.FINALIZED, finalizedAt: new Date(), finalizedById: actor.userId } });
        await this.audit.log(
          actor,
          { action: AuditAction.STATUS_CHANGE, entity: 'payroll', entityId: run.id, summary: `Finalized payroll ${month}: ${slips.length} employees, loan EMIs ${r2(loanTotal)}; attendance of ${month} closed` },
          tx,
        );
        return { employees: slips.length };
      },
      { timeout: 60_000 },
    );
  }

  /** Back to draft: loan EMIs given back, attendance open again. Not after it is paid. */
  revoke(month: string, actor: Actor) {
    return this.prisma.$transaction(
      async (tx) => {
        const run = await tx.payrollRun.findUnique({ where: { month }, include: { payslips: { include: { loanRepayments: true } } } });
        if (!run) throw new BadRequestException(`Payroll for ${month} is not prepared`);
        if (run.status !== PayrollStatus.FINALIZED) throw new BadRequestException(run.status === PayrollStatus.PAID ? 'Salaries are already paid; it cannot be revoked' : 'Only a finalized payroll can be revoked');
        for (const r of run.payslips.flatMap((p) => p.loanRepayments)) {
          const loan = await tx.employeeLoan.findUniqueOrThrow({ where: { id: r.loanId } });
          await tx.employeeLoan.update({ where: { id: r.loanId }, data: { balance: r2(n(loan.balance) + n(r.amount)), ...(loan.status === LoanStatus.CLOSED ? { status: LoanStatus.ACTIVE } : {}) } });
          await tx.loanRepayment.delete({ where: { id: r.id } });
        }
        await tx.attendanceLock.deleteMany({ where: { date: { in: monthDates(month).map(dateOf) } } });
        await tx.payrollRun.update({ where: { id: run.id }, data: { status: PayrollStatus.DRAFT, finalizedAt: null, finalizedById: null } });
        await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'payroll', entityId: run.id, summary: `Revoked payroll ${month}: loan EMIs given back, attendance open again` }, tx);
        return { ok: true };
      },
      { timeout: 60_000 },
    );
  }

  async markPaid(month: string, input: PayrollPaidInput, actor: Actor) {
    const run = await this.prisma.payrollRun.findUnique({ where: { month } });
    if (!run || run.status !== PayrollStatus.FINALIZED) throw new BadRequestException('Finalize the payroll first');
    await this.prisma.payrollRun.update({ where: { id: run.id }, data: { status: PayrollStatus.PAID, paidAt: dateOf(input.paidOn), paidById: actor.userId, paymentRef: input.paymentRef || null } });
    await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'payroll', entityId: run.id, summary: `Salaries of ${month} paid on ${input.paidOn}${input.paymentRef ? ` (${input.paymentRef})` : ''}` });
    return { ok: true };
  }

  async remove(month: string, actor: Actor) {
    const run = await this.draft(this.prisma, month);
    await this.prisma.payrollRun.delete({ where: { id: run.id } });
    await this.audit.log(actor, { action: AuditAction.DELETE, entity: 'payroll', entityId: run.id, summary: `Deleted draft payroll ${month}` });
  }

  async payslips(month: string, id?: number): Promise<{ run: { month: string; monthDays: number; status: PayrollStatus }; payslips: PayslipFull[] }> {
    const run = await this.prisma.payrollRun.findUnique({ where: { month } });
    if (!run) throw new BadRequestException(`Payroll for ${month} is not prepared`);
    const payslips = await this.prisma.payslip.findMany({ where: { payrollRunId: run.id, ...(id ? { id } : {}) }, include: payslipInclude });
    return { run, payslips: payslips.sort((a, b) => codeOrder(a.employee.empCode, b.employee.empCode)) };
  }
}
