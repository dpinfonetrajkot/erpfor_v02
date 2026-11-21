import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  monthString,
  payrollAdjustSchema,
  payrollPaidSchema,
  payrollSettingsSchema,
  type PayrollAdjustInput,
  type PayrollPaidInput,
  type PayrollSettingsInput,
} from '@bht/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { sendCsv } from '../common/csv';
import type { Actor } from '../common/auth-user';
import { PayrollService } from './payroll.service';
import { renderPayslipsPdf } from './payslip-pdf';

const monthParam = new ZodValidationPipe(monthString());
const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));

function sendPdf(res: Response, fileName: string, buffer: Buffer, download?: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(buffer);
}

@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermission('payroll.view')
  list() {
    return this.payroll.list();
  }

  @Get('settings')
  @RequirePermission('payroll.view')
  settings() {
    return this.payroll.settings();
  }

  @Put('settings')
  @RequirePermission('payroll.approve')
  saveSettings(@Body(new ZodValidationPipe(payrollSettingsSchema)) body: PayrollSettingsInput, @CurrentActor() actor: Actor) {
    return this.payroll.saveSettings(body, actor);
  }

  @Put('payslips/:id')
  @RequirePermission('payroll.update')
  adjust(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(payrollAdjustSchema)) body: PayrollAdjustInput, @CurrentActor() actor: Actor) {
    return this.payroll.adjust(id, body, actor);
  }

  @Get('payslips/:id/pdf')
  @RequirePermission('payroll.view')
  async payslipPdf(@Param('id', ParseIntPipe) id: number, @Query('download') download: string | undefined, @Res() res: Response) {
    const p = await this.prisma.payslip.findUniqueOrThrow({ where: { id }, select: { payrollRun: { select: { month: true } } } });
    const { run, payslips } = await this.payroll.payslips(p.payrollRun.month, id);
    const company = await this.prisma.company.findFirst({ where: { isDefault: true } });
    sendPdf(res, `Payslip-${run.month}-${payslips[0]?.employee.empCode ?? id}.pdf`, await renderPayslipsPdf(run, payslips, company), download);
  }

  @Get(':month')
  @RequirePermission('payroll.view')
  month(@Param('month', monthParam) month: string) {
    return this.payroll.month(month);
  }

  @Post(':month/prepare')
  @RequirePermission('payroll.create')
  prepare(@Param('month', monthParam) month: string, @CurrentActor() actor: Actor) {
    return this.payroll.prepare(month, actor);
  }

  @Post(':month/recalculate')
  @RequirePermission('payroll.update')
  recalculate(@Param('month', monthParam) month: string, @CurrentActor() actor: Actor) {
    return this.payroll.recalculate(month, actor);
  }

  @Post(':month/finalize')
  @RequirePermission('payroll.approve')
  finalize(@Param('month', monthParam) month: string, @CurrentActor() actor: Actor) {
    return this.payroll.finalize(month, actor);
  }

  @Post(':month/revoke')
  @RequirePermission('payroll.approve')
  revoke(@Param('month', monthParam) month: string, @CurrentActor() actor: Actor) {
    return this.payroll.revoke(month, actor);
  }

  @Post(':month/paid')
  @RequirePermission('payroll.approve')
  paid(@Param('month', monthParam) month: string, @Body(new ZodValidationPipe(payrollPaidSchema)) body: PayrollPaidInput, @CurrentActor() actor: Actor) {
    return this.payroll.markPaid(month, body, actor);
  }

  @Delete(':month')
  @HttpCode(204)
  @RequirePermission('payroll.delete')
  async remove(@Param('month', monthParam) month: string, @CurrentActor() actor: Actor) {
    await this.payroll.remove(month, actor);
  }

  @Get(':month/payslips.pdf')
  @RequirePermission('payroll.view')
  async allPayslips(@Param('month', monthParam) month: string, @Query('download') download: string | undefined, @Res() res: Response) {
    const { run, payslips } = await this.payroll.payslips(month);
    const company = await this.prisma.company.findFirst({ where: { isDefault: true } });
    sendPdf(res, `Payslips-${month}.pdf`, await renderPayslipsPdf(run, payslips, company), download);
  }

  /** Salary register: every number of every payslip, for the accounts and the PF return. */
  @Get(':month/register')
  @RequirePermission('payroll.view')
  async register(@Param('month', monthParam) month: string, @Res() res: Response) {
    const { payslips } = await this.payroll.payslips(month);
    sendCsv(
      res,
      `salary-register-${month}.csv`,
      ['Code', 'Name', 'Department', 'UAN', 'Basic', 'Shift hours', 'Present', 'Paid leave', 'Payable days', 'Absent', 'Sundays worked', 'Hours worked', 'Expected hours', 'Hour difference', 'Pay for days', 'Hour adjustment', 'Gross', 'PF', 'Loan EMI', 'Other +/-', 'Other note', 'Round off', 'Net pay'],
      payslips.map((p) => [
        p.employee.empCode, p.employee.name, p.employee.department?.name, p.employee.uan, n(p.basicSalary), n(p.shiftHours), n(p.presentDays), n(p.paidLeaveDays), n(p.payableDays), n(p.absentDays), p.sundaysWorked,
        n(p.hoursWorked), n(p.expectedHours), n(p.hourDifference), n(p.baseEarning), n(p.hourAdjustment), n(p.grossEarning), n(p.pfDeduction), n(p.loanDeduction), n(p.otherAdjustment), p.adjustmentNote, n(p.roundOff), n(p.netSalary),
      ]),
    );
  }

  /** For the bank's bulk transfer: who gets how much, on which account. */
  @Get(':month/bank')
  @RequirePermission('payroll.view')
  async bank(@Param('month', monthParam) month: string, @Res() res: Response) {
    const { payslips } = await this.payroll.payslips(month);
    sendCsv(
      res,
      `salary-bank-${month}.csv`,
      ['Code', 'Name', 'Bank', 'Account no', 'IFSC', 'Amount', 'Narration'],
      payslips.filter((p) => n(p.netSalary) > 0).map((p) => [p.employee.empCode, p.employee.name, p.employee.bankName, p.employee.bankAccountNo ?? 'CASH', p.employee.bankIfsc, n(p.netSalary), `Salary ${month}`]),
    );
  }
}
