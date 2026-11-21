import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  departmentSchema,
  EMPLOYEE_STATUSES,
  employeeSchema,
  listQuerySchema,
  type DepartmentInput,
  type EmployeeInput,
} from '@bht/shared';
import { AuditAction, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { diff, normalize } from '../common/normalize';
import { sendCsv } from '../common/csv';
import type { Actor } from '../common/auth-user';
import { AttendanceService, codeOrder } from './attendance.service';

const employeeQuerySchema = listQuerySchema.extend({
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  departmentId: z.coerce.number().int().positive().optional(),
});
type EmployeeQuery = z.infer<typeof employeeQuerySchema>;

const include = { department: { select: { id: true, name: true } } } as const;
const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
/** Date fields whose names do not end in "Date" (normalize turns those into dates by itself). */
const EMPLOYEE_DATES = ['dateOfBirth', 'dateOfJoining', 'leftOn'];

/** Employee master. Codes are the user numbers on the biometric machine. */
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
  ) {}

  private where(q: EmployeeQuery): Prisma.EmployeeWhereInput {
    return {
      ...(q.status ? { status: q.status } : {}),
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.search
        ? { OR: [{ empCode: { contains: q.search } }, { name: { contains: q.search } }, { phone: { contains: q.search } }, { designation: { contains: q.search } }] }
        : {}),
    };
  }

  /** Few hundred rows at most: sorted here so codes go 1, 2, 10 (not 1, 10, 2). */
  @Get()
  @RequirePermission('employees.view')
  async list(@Query(new ZodValidationPipe(employeeQuerySchema)) q: EmployeeQuery) {
    const rows = await this.prisma.employee.findMany({ where: this.where(q), include });
    const key = q.sortBy ?? 'empCode';
    const dir = q.sortDir === 'desc' ? -1 : 1;
    const value = (e: (typeof rows)[number]) =>
      key === 'name' ? e.name : key === 'basicSalary' ? n(e.basicSalary) : key === 'dateOfJoining' ? (e.dateOfJoining?.getTime() ?? 0) : key === 'department' ? (e.department?.name ?? '') : e.empCode;
    rows.sort((a, b) => {
      if (key === 'empCode') return dir * codeOrder(a.empCode, b.empCode);
      const va = value(a);
      const vb = value(b);
      return dir * (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb)));
    });
    const page = rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    return { data: page, total: rows.length, page: q.page, pageSize: q.pageSize };
  }

  @Get('export')
  @RequirePermission('employees.view')
  async export(@Query(new ZodValidationPipe(employeeQuerySchema)) q: EmployeeQuery, @Res() res: Response) {
    const rows = (await this.prisma.employee.findMany({ where: this.where(q), include })).sort((a, b) => codeOrder(a.empCode, b.empCode));
    sendCsv(
      res,
      `employees-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Code', 'Name', 'Gender', 'Department', 'Designation', 'Joined', 'Phone', 'Basic salary', 'CTC', 'Shift hours', 'PF', 'UAN', 'Bank', 'Account no', 'IFSC', 'Status', 'Left on'],
      rows.map((e) => [e.empCode, e.name, e.gender, e.department?.name, e.designation, e.dateOfJoining, e.phone, n(e.basicSalary), e.ctc == null ? '' : n(e.ctc), n(e.shiftHours), e.isPfEligible ? 'Yes' : 'No', e.uan, e.bankName, e.bankAccountNo, e.bankIfsc, e.status, e.leftOn]),
    );
  }

  /** One employee with this year's leave, running loans, latest payslips and assets. */
  @Get(':id')
  @RequirePermission('employees.view')
  async get(@Param('id', ParseIntPipe) id: number) {
    const year = new Date().getFullYear();
    const e = await this.prisma.employee.findUniqueOrThrow({
      where: { id },
      include: {
        ...include,
        leaveBalances: { where: { year } },
        loans: { where: { status: { not: 'CLOSED' } }, orderBy: { id: 'desc' } },
        payslips: { orderBy: { payrollRun: { month: 'desc' } }, take: 12, select: { id: true, netSalary: true, payableDays: true, payrollRun: { select: { month: true, status: true } } } },
        assets: { orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, status: true, assignDate: true } },
      },
    });
    const used = await this.prisma.leaveRequest.groupBy({
      by: ['type'],
      where: { employeeId: id, status: 'APPROVED', fromDate: { gte: new Date(`${year}-01-01T00:00:00Z`), lte: new Date(`${year}-12-31T00:00:00Z`) } },
      _sum: { days: true },
    });
    return { ...e, leaveYear: year, leaveUsed: Object.fromEntries(used.map((u) => [u.type, n(u._sum.days)])) };
  }

  @Post()
  @RequirePermission('employees.create')
  create(@Body(new ZodValidationPipe(employeeSchema)) body: EmployeeInput, @CurrentActor() actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.employee.create({ data: { ...normalize(body, EMPLOYEE_DATES), name: body.name.toUpperCase() }, include });
      // punches the machine already sent for this code count from now on
      const applied = await this.attendance.applyWaiting(tx, e.id, e.empCode);
      await this.audit.log(
        actor,
        { action: AuditAction.CREATE, entity: 'employee', entityId: e.id, summary: `Added employee ${e.empCode} ${e.name}${applied ? ` (${applied} earlier punches counted)` : ''}` },
        tx,
      );
      return e;
    });
  }

  @Put(':id')
  @RequirePermission('employees.update')
  async update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(employeeSchema)) body: EmployeeInput, @CurrentActor() actor: Actor) {
    const before = await this.prisma.employee.findUniqueOrThrow({ where: { id }, include });
    if (before.empCode !== body.empCode && (await this.prisma.attendance.count({ where: { employeeId: id } }))) {
      throw new BadRequestException({ message: 'The code cannot change after attendance is recorded (it is the number on the machine)', errors: { empCode: 'Already used on the machine' } });
    }
    const e = await this.prisma.employee.update({
      where: { id },
      data: { ...normalize(body, EMPLOYEE_DATES), name: body.name.toUpperCase(), ...(body.status === 'ACTIVE' ? { leftOn: null } : {}) },
      include,
    });
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'employee', entityId: id, summary: `Updated employee ${e.empCode} ${e.name}`, changes: diff(before, e) });
    return e;
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('employees.delete')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    const e = await this.prisma.employee.findUniqueOrThrow({ where: { id }, include: { _count: { select: { attendance: true, payslips: true, loans: true, leaveRequests: true } } } });
    if (e._count.attendance || e._count.payslips || e._count.loans || e._count.leaveRequests) {
      throw new BadRequestException('This employee has attendance, leave, loans or payslips - mark as Left instead');
    }
    await this.prisma.employee.delete({ where: { id } });
    await this.audit.log(actor, { action: AuditAction.DELETE, entity: 'employee', entityId: id, summary: `Deleted employee ${e.empCode} ${e.name}` });
  }
}

@Controller('departments')
export class DepartmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('employees.view')
  list() {
    return this.prisma.department.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { employees: true } } } });
  }

  @Post()
  @RequirePermission('employees.create', 'employees.update')
  async create(@Body(new ZodValidationPipe(departmentSchema)) body: DepartmentInput, @CurrentActor() actor: Actor) {
    const d = await this.prisma.department.create({ data: { name: body.name.trim() } });
    await this.audit.log(actor, { action: AuditAction.CREATE, entity: 'department', entityId: d.id, summary: `Added department ${d.name}` });
    return d;
  }

  @Put(':id')
  @RequirePermission('employees.update')
  async update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(departmentSchema)) body: DepartmentInput, @CurrentActor() actor: Actor) {
    const d = await this.prisma.department.update({ where: { id }, data: { name: body.name.trim() } });
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'department', entityId: id, summary: `Renamed department to ${d.name}` });
    return d;
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('employees.delete')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    if (await this.prisma.employee.count({ where: { departmentId: id } })) throw new BadRequestException('Move its employees to another department first');
    const d = await this.prisma.department.delete({ where: { id } });
    await this.audit.log(actor, { action: AuditAction.DELETE, entity: 'department', entityId: id, summary: `Deleted department ${d.name}` });
  }
}
