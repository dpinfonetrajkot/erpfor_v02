import { BadRequestException, Injectable } from '@nestjs/common';
import { isSunday, monthDates, pairHours, PAID_LEAVE_TYPES, type AttendanceDayInput } from '@bht/shared';
import { AttendanceSource, AuditAction, Prisma } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import type { Actor } from '../common/auth-user';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
export const dateOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
export const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
/** Today in India, "YYYY-MM-DD". */
export const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
/** "09:05:33" / "9:05" -> "09:05" */
export const hhmm = (t: string) => {
  const [h, m] = t.trim().split(':');
  return `${h.padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`;
};

export interface IncomingPunch {
  empCode: string;
  date: string;
  time: string;
  source: AttendanceSource;
  deviceSerial?: string | null;
}

/** Leave days of approved requests that fall on each date (half day = 0.5). */
export function leaveByDate(leaves: { type: string; fromDate: Date; toDate: Date; isHalfDay: boolean }[], from: string, to: string) {
  const out = new Map<string, { type: string; days: number }>();
  for (const l of leaves) {
    for (let d = new Date(l.fromDate); d <= l.toDate; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = ymdOf(d);
      if (day < from || day > to || isSunday(day)) continue;
      out.set(day, { type: l.type, days: l.isHalfDay ? 0.5 : 1 });
    }
  }
  return out;
}

/**
 * Daily attendance from punches. Raw punches are kept in attendance_punches; the day row holds the
 * merged IN / OUT list, the first and last time and the hours of the IN-OUT pairs.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async lockedDates(tx: Tx | PrismaService, dates: string[]) {
    if (!dates.length) return new Set<string>();
    const locks = await tx.attendanceLock.findMany({ where: { date: { in: dates.map(dateOf) } } });
    return new Set(locks.map((l) => ymdOf(l.date)));
  }

  /** Stores punches (duplicates ignored) and adds them to each day. Unknown codes and closed days are kept but not counted. */
  async addPunches(punches: IncomingPunch[]) {
    const clean = punches
      .map((p) => ({ ...p, empCode: p.empCode.trim(), time: `${hhmm(p.time)}:${(p.time.split(':')[2] ?? '00').padStart(2, '0')}` }))
      .filter((p) => p.empCode && /^\d{4}-\d{2}-\d{2}$/.test(p.date));
    if (!clean.length) return { received: 0, added: 0, unknown: 0, locked: 0 };
    const employees = await this.prisma.employee.findMany({ where: { empCode: { in: [...new Set(clean.map((p) => p.empCode))] } }, select: { id: true, empCode: true } });
    const idOf = new Map(employees.map((e) => [e.empCode, e.id]));
    const locked = await this.lockedDates(this.prisma, [...new Set(clean.map((p) => p.date))]);
    const rows = clean.map((p) => {
      const employeeId = idOf.get(p.empCode) ?? null;
      return {
        empCode: p.empCode,
        employeeId,
        date: dateOf(p.date),
        time: p.time,
        source: p.source,
        deviceSerial: p.deviceSerial ?? null,
        applied: employeeId != null && !locked.has(p.date),
      };
    });
    // which ones are new (the same punch can arrive twice from the machine)
    const sortedDates = clean.map((p) => p.date).sort();
    const existing = await this.prisma.attendancePunch.findMany({
      where: { empCode: { in: [...new Set(rows.map((r) => r.empCode))] }, date: { gte: dateOf(sortedDates[0]), lte: dateOf(sortedDates[sortedDates.length - 1]) } },
      select: { empCode: true, date: true, time: true },
    });
    const seen = new Set(existing.map((e) => `${e.empCode}|${ymdOf(e.date)}|${e.time}`));
    const fresh = rows.filter((r) => {
      const key = `${r.empCode}|${ymdOf(r.date)}|${r.time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length) await this.prisma.attendancePunch.createMany({ data: fresh, skipDuplicates: true });

    // add the new times to each day
    const byDay = new Map<string, { employeeId: number; date: string; times: string[]; source: AttendanceSource }>();
    for (const r of fresh.filter((f) => f.applied)) {
      const key = `${r.employeeId}|${ymdOf(r.date)}`;
      const d = byDay.get(key) ?? { employeeId: r.employeeId!, date: ymdOf(r.date), times: [], source: r.source };
      d.times.push(hhmm(r.time));
      byDay.set(key, d);
    }
    for (const d of byDay.values()) await this.mergeDay(d.employeeId, d.date, d.times, d.source);
    return {
      received: clean.length,
      added: fresh.filter((f) => f.applied).length,
      unknown: fresh.filter((f) => f.employeeId == null).length,
      locked: fresh.filter((f) => f.employeeId != null && !f.applied).length,
    };
  }

  private async mergeDay(employeeId: number, date: string, times: string[], source: AttendanceSource) {
    const day = await this.prisma.attendance.findUnique({ where: { employeeId_date: { employeeId, date: dateOf(date) } } });
    const list = ((day?.punches as string[] | null) ?? []).slice();
    for (const t of times) if (!list.includes(t)) list.push(t);
    list.sort();
    await this.saveDay(this.prisma, employeeId, date, list, day ? day.source : source, day?.updatedById ?? null);
  }

  private async saveDay(tx: Tx | PrismaService, employeeId: number, date: string, punches: string[], source: AttendanceSource, updatedById: number | null, remarks?: string | null) {
    const { hours } = pairHours(punches);
    const data = {
      punches,
      inTime: punches[0] ?? null,
      outTime: punches.length > 1 ? punches[punches.length - 1] : null,
      hoursWorked: hours,
      source,
      updatedById,
      ...(remarks !== undefined ? { remarks } : {}),
    };
    return tx.attendance.upsert({
      where: { employeeId_date: { employeeId, date: dateOf(date) } },
      create: { employeeId, date: dateOf(date), ...data },
      update: data,
    });
  }

  /** HR sets the punches of a day by hand (forgot to punch, machine down ...). An empty list removes the day. */
  async setDay(input: AttendanceDayInput, actor: Actor) {
    if ((await this.lockedDates(this.prisma, [input.date])).size) throw new BadRequestException('This day is closed by a finalized payroll; revoke the payroll first');
    const emp = await this.prisma.employee.findUniqueOrThrow({ where: { id: input.employeeId }, select: { id: true, empCode: true, name: true } });
    const punches = [...new Set(input.punches.map(hhmm))].sort();
    const before = await this.prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: dateOf(input.date) } } });
    const result = await this.prisma.$transaction(async (tx) => {
      if (!punches.length) {
        if (before) await tx.attendance.delete({ where: { id: before.id } });
      } else {
        await this.saveDay(tx, emp.id, input.date, punches, AttendanceSource.MANUAL, actor.userId, input.remarks || null);
      }
      await this.audit.log(
        actor,
        {
          action: AuditAction.UPDATE,
          entity: 'attendance',
          entityId: emp.id,
          summary: `Attendance of ${emp.empCode} ${emp.name} on ${input.date}: ${punches.join(', ') || 'removed'}`,
          changes: { before: (before?.punches as string[] | null) ?? [], after: punches, remarks: input.remarks },
        },
        tx,
      );
      return { ok: true };
    });
    return result;
  }

  // ------------------------------------------------------------------ views

  /** Employees to show for a period: working, or left on / after its first day. */
  private employeesFor(from: string, filter: { departmentId?: number; search?: string; employeeId?: number }) {
    return this.prisma.employee.findMany({
      where: {
        OR: [{ status: 'ACTIVE' }, { leftOn: { gte: dateOf(from) } }],
        ...(filter.employeeId ? { id: filter.employeeId } : {}),
        ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
        ...(filter.search ? { OR: [{ empCode: { contains: filter.search } }, { name: { contains: filter.search } }] } : {}),
      },
      select: { id: true, empCode: true, name: true, designation: true, shiftHours: true, dateOfJoining: true, leftOn: true, department: { select: { name: true } } },
    });
  }

  /** One row per employee for a month: present days, Sundays worked, leave, hours, short / extra hours, missing punches, a status per date. */
  async month(month: string, filter: { departmentId?: number; search?: string; employeeId?: number }) {
    const dates = monthDates(month);
    const from = dates[0];
    const to = dates[dates.length - 1];
    const today = todayIst();
    const employees = await this.employeesFor(from, filter);
    const ids = employees.map((e) => e.id);
    const [days, leaves, locks] = await Promise.all([
      this.prisma.attendance.findMany({ where: { employeeId: { in: ids }, date: { gte: dateOf(from), lte: dateOf(to) } } }),
      this.prisma.leaveRequest.findMany({ where: { employeeId: { in: ids }, status: 'APPROVED', fromDate: { lte: dateOf(to) }, toDate: { gte: dateOf(from) } } }),
      this.lockedDates(this.prisma, dates),
    ]);
    const rows = employees
      .map((e) => {
        const mine = new Map(days.filter((d) => d.employeeId === e.id).map((d) => [ymdOf(d.date), d]));
        const leave = leaveByDate(leaves.filter((l) => l.employeeId === e.id), from, to);
        const joined = e.dateOfJoining ? ymdOf(e.dateOfJoining) : null;
        const left = e.leftOn ? ymdOf(e.leftOn) : null;
        let present = 0, sundays = 0, hours = 0, missing = 0, paidLeave = 0, lwp = 0, absent = 0;
        const status: Record<string, string> = {};
        for (const date of dates) {
          const d = mine.get(date);
          const punches = (d?.punches as string[] | null) ?? [];
          const l = leave.get(date);
          if ((joined && date < joined) || (left && date > left)) status[date] = '';
          else if (isSunday(date)) {
            status[date] = punches.length ? 'SW' : 'S';
            if (punches.length) sundays++;
          } else if (punches.length) {
            present++;
            hours += n(d!.hoursWorked);
            const odd = punches.length % 2 === 1;
            if (odd) missing++;
            status[date] = odd ? 'M' : 'P';
          } else if (l) {
            if (PAID_LEAVE_TYPES.includes(l.type as never)) paidLeave += l.days;
            else lwp += l.days;
            status[date] = l.type;
          } else if (date <= today) {
            absent++;
            status[date] = 'A';
          } else status[date] = '';
        }
        const shift = n(e.shiftHours);
        return {
          employee: { id: e.id, empCode: e.empCode, name: e.name, designation: e.designation, department: e.department?.name ?? null },
          shiftHours: shift,
          presentDays: present,
          sundaysWorked: sundays,
          paidLeaveDays: paidLeave,
          lwpDays: lwp,
          absentDays: absent,
          hoursWorked: r2(hours),
          expectedHours: r2(present * shift),
          hourDifference: r2(hours - present * shift),
          missingPunchDays: missing,
          status,
        };
      })
      .sort((a, b) => codeOrder(a.employee.empCode, b.employee.empCode));
    return { month, dates, locked: dates.filter((d) => locks.has(d)), rows };
  }

  /** Every employee for one date: punches, hours, leave, status. */
  async day(date: string, filter: { departmentId?: number; search?: string }) {
    const employees = await this.employeesFor(date, filter);
    const ids = employees.map((e) => e.id);
    const [days, leaves, locked] = await Promise.all([
      this.prisma.attendance.findMany({ where: { employeeId: { in: ids }, date: dateOf(date) } }),
      this.prisma.leaveRequest.findMany({ where: { employeeId: { in: ids }, status: 'APPROVED', fromDate: { lte: dateOf(date) }, toDate: { gte: dateOf(date) } } }),
      this.lockedDates(this.prisma, [date]),
    ]);
    const rows = employees
      .filter((e) => !(e.dateOfJoining && ymdOf(e.dateOfJoining) > date))
      .map((e) => {
        const d = days.find((x) => x.employeeId === e.id);
        const punches = (d?.punches as string[] | null) ?? [];
        const leave = leaves.find((l) => l.employeeId === e.id);
        return {
          employee: { id: e.id, empCode: e.empCode, name: e.name, designation: e.designation, department: e.department?.name ?? null },
          shiftHours: n(e.shiftHours),
          punches,
          hoursWorked: n(d?.hoursWorked),
          missingPunch: punches.length % 2 === 1,
          source: d?.source ?? null,
          remarks: d?.remarks ?? null,
          leave: leave ? { type: leave.type, isHalfDay: leave.isHalfDay } : null,
        };
      })
      .sort((a, b) => codeOrder(a.employee.empCode, b.employee.empCode));
    return { date, isSunday: isSunday(date), locked: locked.size > 0, rows };
  }

  /** Punches that came in for employee codes not in the employee list. */
  unknownCodes() {
    return this.prisma.attendancePunch
      .groupBy({ by: ['empCode'], where: { employeeId: null }, _count: { _all: true }, _min: { date: true }, _max: { date: true } })
      .then((g) => g.map((r) => ({ empCode: r.empCode, punches: r._count._all, from: r._min.date, to: r._max.date })));
  }

  /** After an employee is added with a code the machine already used: count those punches now (open days only). */
  async applyWaiting(tx: Tx, employeeId: number, empCode: string) {
    const waiting = await tx.attendancePunch.findMany({ where: { empCode, employeeId: null } });
    if (!waiting.length) return 0;
    await tx.attendancePunch.updateMany({ where: { empCode, employeeId: null }, data: { employeeId } });
    const locked = await this.lockedDates(tx, [...new Set(waiting.map((w) => ymdOf(w.date)))]);
    const open = waiting.filter((w) => !locked.has(ymdOf(w.date)));
    await tx.attendancePunch.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { applied: true } });
    const byDay = new Map<string, string[]>();
    for (const w of open) byDay.set(ymdOf(w.date), [...(byDay.get(ymdOf(w.date)) ?? []), hhmm(w.time)]);
    for (const [date, times] of byDay) {
      const list = [...new Set(times)].sort();
      await this.saveDay(tx, employeeId, date, list, AttendanceSource.DEVICE, null);
    }
    return open.length;
  }
}

/** Employee codes in number order (1, 2, 10, 1001), as the old ERP listed them. */
export function codeOrder(a: string, b: string) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, 'en', { numeric: true });
}
