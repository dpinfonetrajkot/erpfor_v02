import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  attendanceDaySchema,
  attendanceImportSchema,
  deviceSchema,
  monthString,
  type AttendanceDayInput,
  type AttendanceImportInput,
  type DeviceInput,
} from '@bht/shared';
import { AttendanceSource, AuditAction } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NotificationsService } from '../core/notifications.service';
import { CurrentActor, Public, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { sendCsv } from '../common/csv';
import type { Actor } from '../common/auth-user';
import { AttendanceService, hhmm } from './attendance.service';
import { parseAttendanceCsv } from './attendance-csv';

const optionalInt = z.coerce.number().int().positive().optional();
const monthQuery = z.object({ month: monthString(), departmentId: optionalInt, employeeId: optionalInt, search: z.string().trim().max(100).optional() });
const dayQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), departmentId: optionalInt, search: z.string().trim().max(100).optional() });
const previewSchema = z.object({ csv: z.string().min(1, 'The file is empty').max(5_000_000, 'File too big (5 MB)') });

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('month')
  @RequirePermission('attendance.view')
  month(@Query(new ZodValidationPipe(monthQuery)) q: z.infer<typeof monthQuery>) {
    return this.attendance.month(q.month, q);
  }

  @Get('month/export')
  @RequirePermission('attendance.view')
  async monthCsv(@Query(new ZodValidationPipe(monthQuery)) q: z.infer<typeof monthQuery>, @Res() res: Response) {
    const m = await this.attendance.month(q.month, q);
    sendCsv(
      res,
      `attendance-${q.month}.csv`,
      ['Code', 'Name', 'Department', 'Present days', 'Sundays worked', 'Paid leave', 'Leave without pay', 'Absent', 'Hours worked', 'Expected hours', 'Short (-) / extra (+) hours', 'Days with a missing punch', ...m.dates.map((d) => d.slice(8))],
      m.rows.map((r) => [
        r.employee.empCode, r.employee.name, r.employee.department, r.presentDays, r.sundaysWorked, r.paidLeaveDays, r.lwpDays, r.absentDays,
        r.hoursWorked, r.expectedHours, r.hourDifference, r.missingPunchDays, ...m.dates.map((d) => r.status[d]),
      ]),
    );
  }

  @Get('day')
  @RequirePermission('attendance.view')
  day(@Query(new ZodValidationPipe(dayQuery)) q: z.infer<typeof dayQuery>) {
    return this.attendance.day(q.date, q);
  }

  @Put('day')
  @RequirePermission('attendance.update')
  setDay(@Body(new ZodValidationPipe(attendanceDaySchema)) body: AttendanceDayInput, @CurrentActor() actor: Actor) {
    return this.attendance.setDay(body, actor);
  }

  /** Reads the machine's CSV export and shows what would be imported; nothing is saved. */
  @Post('import/preview')
  @RequirePermission('attendance.create')
  async preview(@Body(new ZodValidationPipe(previewSchema)) body: z.infer<typeof previewSchema>) {
    const { rows, skipped } = parseAttendanceCsv(body.csv);
    const employees = await this.prisma.employee.findMany({ where: { empCode: { in: [...new Set(rows.map((r) => r.empCode))] } }, select: { id: true, empCode: true, name: true } });
    const byCode = new Map(employees.map((e) => [e.empCode, e]));
    const locked = await this.attendance.lockedDates(this.prisma, [...new Set(rows.map((r) => r.date))]);
    const out = rows.map((r) => ({
      ...r,
      employee: byCode.get(r.empCode) ?? null,
      status: !byCode.has(r.empCode) ? 'UNKNOWN' : locked.has(r.date) ? 'LOCKED' : 'READY',
    }));
    return {
      rows: out,
      skipped,
      ready: out.filter((r) => r.status === 'READY').length,
      unknown: out.filter((r) => r.status === 'UNKNOWN').length,
      locked: out.filter((r) => r.status === 'LOCKED').length,
    };
  }

  @Post('import')
  @RequirePermission('attendance.create')
  async import(@Body(new ZodValidationPipe(attendanceImportSchema)) body: AttendanceImportInput, @CurrentActor() actor: Actor) {
    const result = await this.attendance.addPunches(
      body.rows.flatMap((r) => r.punches.map((t) => ({ empCode: r.empCode, date: r.date, time: hhmm(t), source: AttendanceSource.IMPORT }))),
    );
    const dates = body.rows.map((r) => r.date).sort();
    await this.audit.log(actor, {
      action: AuditAction.CREATE,
      entity: 'attendance',
      summary: `Imported attendance CSV: ${body.rows.length} day rows (${dates[0]} to ${dates[dates.length - 1]}), ${result.added} new punches`,
      changes: result,
    });
    return result;
  }

  @Get('unknown-codes')
  @RequirePermission('attendance.view')
  unknownCodes() {
    return this.attendance.unknownCodes();
  }

  @Get('devices')
  @RequirePermission('attendance.view')
  devices() {
    return this.prisma.biometricDevice.findMany({ orderBy: { createdAt: 'asc' } });
  }

  @Put('devices/:id')
  @RequirePermission('attendance.approve')
  async updateDevice(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(deviceSchema)) body: DeviceInput, @CurrentActor() actor: Actor) {
    const d = await this.prisma.biometricDevice.update({
      where: { id },
      data: { ...(body.name !== undefined ? { name: body.name || null } : {}), ...(body.isApproved !== undefined ? { isApproved: body.isApproved } : {}) },
    });
    const what = body.isApproved === undefined ? `named "${d.name ?? ''}"` : d.isApproved ? 'approved' : 'blocked';
    await this.audit.log(actor, { action: AuditAction.UPDATE, entity: 'biometric_device', entityId: id, summary: `Biometric machine ${d.serialNo}${d.name ? ` (${d.name})` : ''}: ${what}` });
    return d;
  }

  @Delete('devices/:id')
  @HttpCode(204)
  @RequirePermission('attendance.approve')
  async removeDevice(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    const d = await this.prisma.biometricDevice.delete({ where: { id } });
    await this.audit.log(actor, { action: AuditAction.DELETE, entity: 'biometric_device', entityId: id, summary: `Removed biometric machine ${d.serialNo}` });
  }
}

/**
 * eSSL / ZKTeco "ADMS" push protocol. Set the machine's server address to this ERP (port 443 / 80);
 * it calls /iclock/cdata (hello + ATTLOG punches) and /iclock/getrequest (asks for commands).
 * A new machine is registered as "waiting"; until HR approves it in Attendance -> Machines, its
 * requests are refused and it keeps the punches in its memory and sends them later.
 */
@Controller('iclock')
@Public()
@SkipThrottle()
export class AdmsController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async device(req: Request) {
    const sn = String(req.query.SN ?? req.query.sn ?? '').trim().slice(0, 50);
    if (!sn) return null;
    const isNew = !(await this.prisma.biometricDevice.findUnique({ where: { serialNo: sn }, select: { id: true } }));
    const device = await this.prisma.biometricDevice.upsert({
      where: { serialNo: sn },
      create: { serialNo: sn, lastSeenAt: new Date(), lastIp: req.ip ?? null },
      update: { lastSeenAt: new Date(), lastIp: req.ip ?? null },
    });
    if (isNew) await this.notifications.toPermission('attendance.approve', { title: `New biometric machine ${sn} waits for approval`, body: req.ip ? `From ${req.ip}` : null, link: '/hr/attendance?tab=machines' });
    return device;
  }

  private refuse(res: Response) {
    res.status(403).type('text/plain').send('Machine not approved in the ERP');
  }

  @Get('cdata')
  async hello(@Req() req: Request, @Res() res: Response) {
    const d = await this.device(req);
    if (!d?.isApproved) return this.refuse(res);
    res
      .type('text/plain')
      .send([`GET OPTION FROM: ${d.serialNo}`, 'ATTLOGStamp=None', 'OPERLOGStamp=9999', 'ATTPHOTOStamp=None', 'ErrorDelay=30', 'Delay=10', 'TransTimes=00:00;14:05', 'TransInterval=1', 'TransFlag=TransData AttLog', 'Realtime=1', 'Encrypt=None'].join('\n'));
  }

  /** ATTLOG lines: "<code>\t<YYYY-MM-DD HH:MM:SS>\t<status>\t<verify>..." */
  @Post('cdata')
  async data(@Req() req: Request, @Res() res: Response) {
    const d = await this.device(req);
    if (!d?.isApproved) return this.refuse(res);
    const table = String(req.query.table ?? '').toUpperCase();
    const body = typeof req.body === 'string' ? req.body : '';
    if (table !== 'ATTLOG') return res.type('text/plain').send('OK');
    const punches = body
      .split(/\r?\n/)
      .map((l) => l.split('\t'))
      .filter((p) => p.length >= 2 && p[0].trim() && /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}/.test(p[1].trim()))
      .map((p) => {
        const [date, time] = p[1].trim().split(' ');
        return { empCode: p[0].trim(), date, time, source: AttendanceSource.DEVICE, deviceSerial: d.serialNo };
      });
    const result = await this.attendance.addPunches(punches);
    if (punches.length) await this.prisma.biometricDevice.update({ where: { id: d.id }, data: { lastPunchAt: new Date() } });
    res.type('text/plain').send(`OK: ${result.received}`);
  }

  @Get('getrequest')
  async commands(@Req() req: Request, @Res() res: Response) {
    const d = await this.device(req);
    if (!d?.isApproved) return this.refuse(res);
    res.type('text/plain').send('OK');
  }

  @Post('devicecmd')
  async commandResult(@Req() req: Request, @Res() res: Response) {
    const d = await this.device(req);
    if (!d?.isApproved) return this.refuse(res);
    res.type('text/plain').send('OK');
  }
}
