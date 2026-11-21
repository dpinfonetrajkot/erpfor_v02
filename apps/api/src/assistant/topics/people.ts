import { fmtHours, LEAVE_STATUS_LABELS, LEAVE_TYPE_LABELS, LOAN_STATUS_LABELS, PAYROLL_STATUS_LABELS, SAFETY_ASSET_STATUS_LABELS, COMPANY_ASSET_STATUS_LABELS, type CompanyAssetStatus, type SafetyAssetStatus } from '@bht/shared';
import { addDays, dayPeriod, has, monthLabel, monthPeriod } from '../language';
import { cap, day, during, list, num, periodParams, plural, qty, R, rupees, table, whichOne, type Ask, type Reply, type Topic } from '../kit';

const ATTENDANCE_WORDS = ['absent', 'present', 'attendance', 'punch', 'punches', 'punched', 'missing punch', 'in office', 'at work', 'came late', 'working days', 'hours', 'overtime', 'ot'];
const SAFETY_DUE_DAYS = 15;
/** Company asset codes such as LAP-01, MOB-12. */
const ASSET_CODE = /^[a-z]{2,4}-\d{1,6}$/;
const dateOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const lastMonth = (today: string) => {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/** The one employee asked about, or a reply asking which one. */
function oneEmployee(ask: Ask, ask2: (code: string) => string): { id: number } | Reply {
  const ids = ask.ids(ask.found.employees, 'employeeId');
  if (ids.length === 1) return { id: ids[0] };
  if (ids.length > 1) return whichOne('employee', ask.found.employees.map((e) => `${e.code} ${e.name}`), (o) => ask2(o.split(' ')[0]));
  return { text: 'Which employee? Type the employee code or name, for example "attendance of 105".' };
}
const isReply = (x: { id: number } | Reply): x is Reply => 'text' in x;

export const peopleTopics: Topic[] = [
  {
    id: 'attendance_day',
    area: 'HR',
    label: 'attendance',
    permissions: ['attendance.view'],
    examples: ['Who is absent today?', 'Who is present today?', 'Missing punches yesterday'],
    score: (p, f) => (has(p, ...ATTENDANCE_WORDS) && !f.employees.length ? 6 : 0),
    async answer(ask) {
      const period = ask.p.period && ask.p.period.from === ask.p.period.to ? ask.p.period : dayPeriod(ask.today, 'today');
      const date = period.from;
      const r = await ask.deps.attendance.day(date, {});
      const present = r.rows.filter((x) => x.punches.length);
      const onLeave = r.rows.filter((x) => !x.punches.length && x.leave);
      const absent = r.isSunday || date > ask.today ? [] : r.rows.filter((x) => !x.punches.length && !x.leave);
      const missing = r.rows.filter((x) => x.missingPunch);
      const when = period.label === 'today' ? 'today' : `on ${day(date)}`;
      const who = (rows: typeof r.rows) => rows.map((x) => [x.employee.empCode, x.employee.name, x.employee.department ?? '—']);
      const focus = has(ask.p, 'missing punch', 'missing') ? 'missing' : has(ask.p, 'absent') ? 'absent' : has(ask.p, 'leave') ? 'leave' : 'present';
      const rows = focus === 'missing' ? missing : focus === 'absent' ? absent : focus === 'leave' ? onLeave : present;
      const text =
        r.isSunday && !present.length
          ? `${day(date)} is a Sunday (weekly off).`
          : date > ask.today
            ? `${plural(onLeave.length, 'employee is', 'employees are')} on leave ${when}${onLeave.length ? ':' : '.'}`
            : focus === 'missing'
              ? missing.length ? `${plural(missing.length, 'employee has', 'employees have')} a punch without its pair ${when}${date === ask.today ? ' (people still at work have only punched in)' : ''}:` : `No missing punch ${when}.`
              : focus === 'absent'
                ? absent.length ? `${plural(absent.length, 'employee is', 'employees are')} absent ${when} (no punch, no leave):` : `Nobody is absent ${when}.`
                : focus === 'leave'
                  ? onLeave.length ? `${plural(onLeave.length, 'employee is', 'employees are')} on leave ${when}:` : `Nobody is on leave ${when}.`
                  : `${present.length} of ${r.rows.length} employees punched in ${when}.`;
      return {
        understood: `Attendance · ${period.label === 'today' ? `today (${day(date)})` : day(date)}`,
        text,
        facts: [
          { label: 'Employees', value: String(r.rows.length) },
          { label: 'Present', value: String(present.length) },
          { label: 'On leave', value: String(onLeave.length) },
          { label: 'Absent', value: String(absent.length), ...(absent.length ? { tone: 'bad' as const } : {}) },
          { label: 'Missing punch', value: String(missing.length) },
        ],
        ...(rows.length && (focus !== 'present' || rows.length <= 25) ? { table: table(['Code', 'Name', 'Department'], who(rows), 25) } : {}),
        links: [{ label: `Attendance of ${day(date)}`, href: `/hr/attendance?tab=day&date=${date}` }],
        params: periodParams(period),
      };
    },
  },

  {
    id: 'attendance_employee',
    area: 'HR',
    label: 'attendance',
    permissions: ['attendance.view'],
    examples: ['Attendance of 105 this month', 'Hours of Ramesh last month'],
    score: (p, f) => (f.employees.length && has(p, ...ATTENDANCE_WORDS, 'days', 'late') ? 8 : 0),
    async answer(ask) {
      const one = oneEmployee(ask, (code) => `Attendance of ${code}`);
      if (isReply(one)) return one;
      const period = ask.period(monthPeriod(ask.today.slice(0, 7), ask.today));
      if (period.from === period.to) {
        const r = await ask.deps.attendance.day(period.from, {});
        const row = r.rows.find((x) => x.employee.id === one.id);
        if (!row) return { text: `That employee was not working on ${day(period.from)}.` };
        const e = row.employee;
        return {
          understood: `Attendance · ${e.empCode} ${e.name} · ${day(period.from)}`,
          text: row.punches.length
            ? `${e.name} punched ${row.punches.join(', ')} on ${day(period.from)}: ${fmtHours(row.hoursWorked)} worked${row.missingPunch ? ' - one punch has no pair' : ''}.`
            : row.leave
              ? `${e.name} was on ${LEAVE_TYPE_LABELS[row.leave.type as keyof typeof LEAVE_TYPE_LABELS].toLowerCase()} on ${day(period.from)}.`
              : r.isSunday ? `${day(period.from)} is a Sunday; ${e.name} did not punch.` : `${e.name} has no punch on ${day(period.from)} (absent).`,
          links: [{ label: 'Attendance', href: `/hr/attendance?tab=day&date=${period.from}&search=${e.empCode}` }],
          params: { employeeId: one.id, ...periodParams(period) },
        };
      }
      const month = period.month ?? period.from.slice(0, 7);
      const r = await ask.deps.attendance.month(month, { employeeId: one.id });
      const row = r.rows[0];
      if (!row) return { text: `That employee was not working in ${monthLabel(month)}.` };
      const e = row.employee;
      return {
        understood: `Attendance · ${e.empCode} ${e.name} · ${monthLabel(month)}`,
        text: `${e.name} in ${monthLabel(month)}: present ${plural(row.presentDays, 'day')} and ${fmtHours(row.hoursWorked)} worked (${row.hourDifference >= 0 ? '+' : ''}${fmtHours(row.hourDifference)} against the shift).`,
        facts: [
          { label: 'Present days', value: String(row.presentDays) },
          { label: 'Paid leave', value: String(row.paidLeaveDays) },
          { label: 'Leave without pay', value: String(row.lwpDays) },
          { label: 'Absent', value: String(row.absentDays), ...(row.absentDays ? { tone: 'bad' as const } : {}) },
          { label: 'Sundays worked', value: String(row.sundaysWorked) },
          { label: 'Missing punches', value: String(row.missingPunchDays), ...(row.missingPunchDays ? { tone: 'bad' as const } : {}) },
        ],
        links: [{ label: `Attendance ${monthLabel(month)}`, href: `/hr/attendance?month=${month}&search=${e.empCode}` }],
        params: { employeeId: one.id, ...periodParams(monthPeriod(month, ask.today)) },
      };
    },
  },

  {
    id: 'leave',
    area: 'HR',
    label: 'leave',
    permissions: ['leaves.view'],
    examples: ['Leave balance of 102', 'Who is on leave this week?', 'Leave waiting for approval'],
    score: (p, f) => (has(p, 'leave', 'cl', 'sl', 'el', 'lwp', 'casual leave', 'sick leave', 'earned leave', 'holiday') ? 6 + (f.employees.length ? 2 : 0) : 0),
    async answer(ask) {
      if (has(ask.p, 'pending', 'waiting', 'to approve', 'approval', 'approve')) {
        const waiting = await ask.prisma.leaveRequest.findMany({ where: { status: 'PENDING' }, orderBy: { fromDate: 'asc' }, select: { type: true, fromDate: true, toDate: true, days: true, employee: { select: { empCode: true, name: true } } } });
        return {
          understood: 'Leave waiting for approval',
          text: waiting.length ? `${plural(waiting.length, 'leave request is', 'leave requests are')} waiting for approval:` : 'No leave is waiting for approval.',
          ...(waiting.length ? { table: table(['Employee', 'Leave', 'Dates', R('Days')], waiting.map((l) => [`${l.employee.empCode} ${l.employee.name}`, LEAVE_TYPE_LABELS[l.type], l.fromDate.getTime() === l.toDate.getTime() ? day(l.fromDate) : `${day(l.fromDate)} – ${day(l.toDate)}`, qty(num(l.days))])) } : {}),
          links: [{ label: 'Leaves', href: '/hr/leaves?status=PENDING' }],
        };
      }
      if (ask.found.employees.length || typeof ask.prev.employeeId === 'number') {
        const one = oneEmployee(ask, (code) => `Leave balance of ${code}`);
        if (isReply(one)) return one;
        const year = Number((ask.p.period?.from ?? ask.today).slice(0, 4));
        const [e, quota, leaves] = await Promise.all([
          ask.prisma.employee.findUnique({ where: { id: one.id }, select: { empCode: true, name: true } }),
          ask.prisma.leaveBalance.findUnique({ where: { employeeId_year: { employeeId: one.id, year } } }),
          ask.prisma.leaveRequest.findMany({ where: { employeeId: one.id, status: { in: ['APPROVED', 'PENDING'] }, fromDate: { gte: dateOf(`${year}-01-01`), lte: dateOf(`${year}-12-31`) } }, orderBy: { fromDate: 'desc' } }),
        ]);
        const used = (t: string) => leaves.filter((l) => l.type === t && l.status === 'APPROVED').reduce((s, l) => s + num(l.days), 0);
        const left = (t: 'CL' | 'SL' | 'EL', allowed: number) => `${qty(allowed - used(t))} of ${qty(allowed)}`;
        return {
          understood: `Leave ${year} · ${e?.empCode} ${e?.name}`,
          text: quota ? `${e?.name}'s leave in ${year}:` : `No leave allowance is set for ${e?.name} in ${year} (Leaves → Balances).`,
          facts: [
            { label: 'Casual leave left', value: left('CL', num(quota?.casual)) },
            { label: 'Sick leave left', value: left('SL', num(quota?.sick)) },
            { label: 'Earned leave left', value: left('EL', num(quota?.earned)) },
            { label: 'Without pay taken', value: `${qty(used('LWP'))} day(s)` },
          ],
          ...(leaves.length ? { table: table(['Leave', 'Dates', R('Days'), 'Status'], leaves.map((l) => [LEAVE_TYPE_LABELS[l.type], l.fromDate.getTime() === l.toDate.getTime() ? day(l.fromDate) : `${day(l.fromDate)} – ${day(l.toDate)}`, qty(num(l.days)), LEAVE_STATUS_LABELS[l.status]]), 6) } : {}),
          links: [{ label: 'Leaves', href: `/hr/leaves?search=${encodeURIComponent(e?.name ?? '')}` }],
          params: { employeeId: one.id },
        };
      }
      // who is on leave in a period (default: today)
      const period = ask.p.period ?? dayPeriod(ask.today, 'today');
      const leaves = await ask.prisma.leaveRequest.findMany({
        where: { status: 'APPROVED', fromDate: { lte: dateOf(period.to) }, toDate: { gte: dateOf(period.from) } },
        orderBy: { fromDate: 'asc' },
        select: { type: true, fromDate: true, toDate: true, employee: { select: { empCode: true, name: true } } },
      });
      return {
        understood: `On leave · ${period.label}`,
        text: leaves.length ? `${cap(plural(leaves.length, 'leave'))} ${during(period)}:` : `Nobody is on leave ${during(period)}.`,
        ...(leaves.length ? { table: table(['Employee', 'Leave', 'Dates'], leaves.map((l) => [`${l.employee.empCode} ${l.employee.name}`, LEAVE_TYPE_LABELS[l.type], l.fromDate.getTime() === l.toDate.getTime() ? day(l.fromDate) : `${day(l.fromDate)} – ${day(l.toDate)}`]), 20) } : {}),
        links: [{ label: 'Leaves', href: '/hr/leaves?status=APPROVED' }],
        params: periodParams(period),
      };
    },
  },

  {
    id: 'loan',
    area: 'HR',
    label: 'loans',
    permissions: ['loans.view'],
    examples: ['Loan balance of 106', 'Total loans outstanding'],
    score: (p, f) => (has(p, 'loan', 'loans', 'advance', 'emi') ? 6 + (f.employees.length ? 2 : 0) : 0),
    async answer(ask) {
      if (ask.found.employees.length || typeof ask.prev.employeeId === 'number') {
        const one = oneEmployee(ask, (code) => `Loan of ${code}`);
        if (isReply(one)) return one;
        const e = await ask.prisma.employee.findUnique({ where: { id: one.id }, select: { empCode: true, name: true, loans: { orderBy: { createdAt: 'desc' }, select: { type: true, amount: true, emiAmount: true, balance: true, startMonth: true, status: true, createdAt: true } } } });
        if (!e) return { text: 'Employee not found.' };
        const open = e.loans.filter((l) => l.status !== 'CLOSED');
        const balance = open.reduce((s, l) => s + num(l.balance), 0);
        return {
          understood: `Loans · ${e.empCode} ${e.name}`,
          text: open.length ? `${e.name} still has to repay ${rupees(balance)} (EMI ${rupees(open.filter((l) => l.status === 'ACTIVE').reduce((s, l) => s + num(l.emiAmount), 0))} a month).` : `${e.name} has no running loan or advance.`,
          ...(e.loans.length ? { table: table(['Given', R('Amount'), R('EMI'), R('Left'), 'Status'], e.loans.map((l) => [day(l.createdAt), rupees(num(l.amount)), rupees(num(l.emiAmount)), rupees(num(l.balance)), LOAN_STATUS_LABELS[l.status]]), 6) } : {}),
          links: [{ label: 'Loans & advances', href: `/hr/loans?search=${encodeURIComponent(e.name)}` }],
          params: { employeeId: one.id },
        };
      }
      const loans = await ask.prisma.employeeLoan.findMany({ where: { status: { not: 'CLOSED' } }, orderBy: { balance: 'desc' }, select: { balance: true, emiAmount: true, status: true, employee: { select: { empCode: true, name: true } } } });
      const total = loans.reduce((s, l) => s + num(l.balance), 0);
      return {
        understood: 'Loans & advances outstanding',
        text: loans.length ? `${plural(loans.length, 'loan / advance', 'loans / advances')} running; employees still have to repay ${rupees(total)}. Biggest first:` : 'No loan or advance is running.',
        ...(loans.length ? { table: table(['Employee', R('Left'), R('EMI'), 'Status'], loans.map((l) => [`${l.employee.empCode} ${l.employee.name}`, rupees(num(l.balance)), rupees(num(l.emiAmount)), LOAN_STATUS_LABELS[l.status]])) } : {}),
        links: [{ label: 'Loans & advances', href: '/hr/loans' }],
      };
    },
  },

  {
    id: 'salary',
    area: 'HR',
    label: 'payroll',
    permissions: ['payroll.view'],
    examples: ['Salary of 101 last month', 'Payroll total for September'],
    score: (p, f) => (has(p, 'salary', 'payslip', 'pay slip', 'net pay', 'payroll', 'pf', 'basic salary', 'ctc') ? 6 + (f.employees.length ? 2 : 0) : 0),
    async answer(ask) {
      const month = ask.p.period?.month ?? (ask.p.period ? ask.p.period.from.slice(0, 7) : typeof ask.prev.month === 'string' ? ask.prev.month : lastMonth(ask.today));
      const run = await ask.prisma.payrollRun.findUnique({ where: { month }, select: { status: true, monthDays: true, paidAt: true } });
      const params = periodParams(monthPeriod(month, ask.today));
      if (ask.found.employees.length || typeof ask.prev.employeeId === 'number') {
        const one = oneEmployee(ask, (code) => `Salary of ${code} ${monthLabel(month)}`);
        if (isReply(one)) return one;
        const e = await ask.prisma.employee.findUnique({ where: { id: one.id }, select: { empCode: true, name: true, basicSalary: true } });
        const slip = run ? await ask.prisma.payslip.findFirst({ where: { employeeId: one.id, payrollRun: { month } } }) : null;
        if (!slip) {
          return {
            understood: `Salary · ${e?.empCode} ${e?.name} · ${monthLabel(month)}`,
            text: `${run ? `${e?.name} has no payslip` : 'Payroll is not prepared'} for ${monthLabel(month)}. Basic salary is ${rupees(num(e?.basicSalary))} a month.`,
            links: [{ label: 'Payroll', href: `/hr/payroll?month=${month}` }],
            params: { ...params, employeeId: one.id },
          };
        }
        return {
          understood: `Salary · ${e?.empCode} ${e?.name} · ${monthLabel(month)}`,
          text: `${e?.name}'s net pay for ${monthLabel(month)} is ${rupees(num(slip.netSalary))} (${PAYROLL_STATUS_LABELS[run!.status].toLowerCase()}).`,
          facts: [
            { label: 'Days paid', value: `${qty(num(slip.payableDays))} of ${run!.monthDays}` },
            { label: 'Gross', value: rupees(num(slip.grossEarning)) },
            { label: 'PF', value: rupees(num(slip.pfDeduction)) },
            { label: 'Loan EMI', value: rupees(num(slip.loanDeduction)) },
            ...(num(slip.otherAdjustment) ? [{ label: 'Other +/−', value: rupees(num(slip.otherAdjustment)) }] : []),
            { label: 'Net pay', value: rupees(num(slip.netSalary)), tone: 'good' as const },
          ],
          links: [
            { label: 'Payslip PDF', href: `/api/payroll/payslips/${slip.id}/pdf` },
            { label: `Payroll ${monthLabel(month)}`, href: `/hr/payroll?month=${month}` },
          ],
          params: { ...params, employeeId: one.id },
        };
      }
      if (!run) return { understood: `Payroll · ${monthLabel(month)}`, text: `Payroll for ${monthLabel(month)} is not prepared yet.`, links: [{ label: 'Payroll', href: `/hr/payroll?month=${month}` }], params };
      const slips = await ask.prisma.payslip.findMany({ where: { payrollRun: { month } }, select: { grossEarning: true, pfDeduction: true, loanDeduction: true, netSalary: true } });
      const sum = (f: (s: (typeof slips)[number]) => number) => slips.reduce((s, x) => s + f(x), 0);
      return {
        understood: `Payroll · ${monthLabel(month)}`,
        text: `Payroll ${monthLabel(month)} (${PAYROLL_STATUS_LABELS[run.status].toLowerCase()}${run.paidAt ? ` on ${day(run.paidAt)}` : ''}): net pay ${rupees(sum((s) => num(s.netSalary)))} for ${plural(slips.length, 'employee')}.`,
        facts: [
          { label: 'Gross', value: rupees(sum((s) => num(s.grossEarning))) },
          { label: 'PF', value: rupees(sum((s) => num(s.pfDeduction))) },
          { label: 'Loan EMI', value: rupees(sum((s) => num(s.loanDeduction))) },
          { label: 'Net pay', value: rupees(sum((s) => num(s.netSalary))), tone: 'good' },
        ],
        links: [{ label: `Payroll ${monthLabel(month)}`, href: `/hr/payroll?month=${month}` }],
        params,
      };
    },
  },

  {
    id: 'employee_info',
    area: 'HR',
    label: 'employees',
    permissions: ['employees.view'],
    examples: ['Details of 105', 'Phone number of Kiran', 'Employees in Forging department'],
    score: (p, f) =>
      (f.employees.length && has(p, 'phone', 'mobile', 'number', 'contact', 'joined', 'joining', 'department', 'designation', 'details', 'detail', 'who is', 'address', 'birthday', 'birth', 'dob', 'uan', 'bank', 'account', 'info', 'about', 'employee')) ||
      (f.departments.length && has(p, 'employees', 'employee', 'who', 'staff', 'list', 'workers', 'people', 'department'))
        ? 7
        : 0,
    async answer(ask) {
      // "employees in forging": the department list, even when a name also looks like a person's
      if (ask.found.departments.length && (!ask.found.employees.length || has(ask.p, 'employees', 'staff', 'workers', 'people', 'list', 'who works'))) {
        const dep = ask.found.departments[0];
        const staff = await ask.prisma.employee.findMany({ where: { departmentId: dep.id, status: 'ACTIVE' }, orderBy: { empCode: 'asc' }, select: { empCode: true, name: true, designation: true, phone: true } });
        return {
          understood: `Employees · ${dep.name}`,
          text: staff.length ? `${plural(staff.length, 'employee works', 'employees work')} in ${dep.name}:` : `Nobody works in ${dep.name} now.`,
          ...(staff.length ? { table: table(['Code', 'Name', 'Designation', 'Phone'], staff.map((s) => [s.empCode, s.name, s.designation ?? '—', s.phone ?? '—']), 30) } : {}),
          links: [{ label: 'Employees', href: `/hr/employees?departmentId=${dep.id}` }],
        };
      }
      const one = oneEmployee(ask, (code) => `Details of ${code}`);
      if (isReply(one)) return one;
      const e = await ask.prisma.employee.findUnique({ where: { id: one.id }, include: { department: { select: { name: true } } } });
      if (!e) return { text: 'Employee not found.' };
      return {
        understood: `Employee ${e.empCode} ${e.name}`,
        text: `${e.empCode} ${e.name}${e.designation ? `, ${e.designation}` : ''}${e.department ? ` in ${e.department.name}` : ''} - ${e.status === 'ACTIVE' ? 'working' : `left on ${day(e.leftOn)}`}.`,
        facts: [
          { label: 'Phone', value: e.phone ?? '—' },
          { label: 'Joined', value: day(e.dateOfJoining) },
          { label: 'Shift', value: `${num(e.shiftHours)} hours` },
          { label: 'PF', value: e.isPfEligible ? `Yes${e.uan ? ` · UAN ${e.uan}` : ''}` : 'No' },
          { label: 'Bank', value: e.bankAccountNo ? `${e.bankName ?? ''} ····${e.bankAccountNo.slice(-4)}` : 'Cash' },
          ...(ask.can('payroll.view') ? [{ label: 'Basic salary', value: `${rupees(num(e.basicSalary))} / month` }] : []),
        ],
        links: [{ label: 'Employee page', href: `/hr/employees/${e.id}` }],
        suggestions: [`Attendance of ${e.empCode} this month`, `Leave balance of ${e.empCode}`],
        params: { employeeId: e.id },
      };
    },
  },

  {
    id: 'safety',
    area: 'HR',
    label: 'safety equipment',
    permissions: ['assets.view'],
    examples: ['Safety checks due', 'Which fire extinguishers are due?'],
    score: (p) => (has(p, 'safety', 'extinguisher', 'extinguishers', 'fire', 'hydrant', 'crane', 'first aid', 'inspection', 'inspections') ? 7 : 0),
    async answer(ask) {
      const due = await ask.prisma.safetyAsset.findMany({
        where: { OR: [{ nextDueDate: { lte: dateOf(addDays(ask.today, SAFETY_DUE_DAYS)) } }, { status: { not: 'OK' } }] },
        orderBy: { nextDueDate: 'asc' },
        select: { code: true, name: true, typeCapacity: true, locationZone: true, nextDueDate: true, status: true },
      });
      const late = due.filter((s) => s.nextDueDate && s.nextDueDate.getTime() < dateOf(ask.today).getTime());
      return {
        understood: `Safety checks due in ${SAFETY_DUE_DAYS} days`,
        text: due.length ? `${plural(due.length, 'safety item needs', 'safety items need')} attention${late.length ? ` (${late.length} late)` : ''}:` : `No safety check is due in the next ${SAFETY_DUE_DAYS} days.`,
        ...(due.length ? { table: table(['Code', 'Item', 'Where', 'Next due', 'Status'], due.map((s) => [s.code, [s.name, s.typeCapacity].filter(Boolean).join(' '), s.locationZone ?? '—', day(s.nextDueDate), SAFETY_ASSET_STATUS_LABELS[s.status as SafetyAssetStatus] ?? s.status]), 15) } : {}),
        links: [{ label: 'Safety equipment', href: '/hr/assets?tab=safety&due=true' }],
      };
    },
  },

  {
    id: 'asset',
    area: 'HR',
    label: 'company assets',
    permissions: ['assets.view'],
    examples: ['Who has LAP-01?', 'Assets with Priya'],
    score: (p, f) => (has(p, 'asset', 'assets', 'laptop', 'laptops', 'computer', 'mobile phone', 'instrument', 'who has', 'given to', 'with whom') ? 6 + (f.employees.length ? 1 : 0) : p.codes.some((c) => ASSET_CODE.test(c)) ? 5 : 0),
    async answer(ask) {
      const codes = ask.p.codes.filter((c) => ASSET_CODE.test(c)).map((c) => c.toUpperCase());
      const assets = codes.length
        ? await ask.prisma.companyAsset.findMany({ where: { code: { in: codes } }, include: { employee: { select: { empCode: true, name: true } } } })
        : ask.found.employees.length === 1
          ? await ask.prisma.companyAsset.findMany({ where: { employeeId: ask.found.employees[0].id }, include: { employee: { select: { empCode: true, name: true } } } })
          : await ask.prisma.companyAsset.findMany({ where: { status: { not: 'SCRAPPED' } }, orderBy: { code: 'asc' }, include: { employee: { select: { empCode: true, name: true } } } });
      const holder = (a: (typeof assets)[number]) => (a.employee ? `${a.employee.empCode} ${a.employee.name}` : (a.department ?? 'In store'));
      const text =
        codes.length && assets.length === 1
          ? `${assets[0].code} ${assets[0].name} is with ${holder(assets[0])}${assets[0].assignDate ? ` since ${day(assets[0].assignDate)}` : ''} (${(COMPANY_ASSET_STATUS_LABELS[assets[0].status as CompanyAssetStatus] ?? assets[0].status).toLowerCase()}).`
          : ask.found.employees.length === 1 && !codes.length
            ? assets.length ? `${ask.found.employees[0].name} has ${list(assets.map((a) => `${a.code} ${a.name}`))}.` : `${ask.found.employees[0].name} has no company asset.`
            : assets.length ? `${plural(assets.length, 'company asset')}:` : codes.length ? `No asset with code ${codes.join(', ')}.` : 'No company asset is recorded.';
      return {
        understood: 'Company assets',
        text,
        ...(assets.length > 1 || (!codes.length && !ask.found.employees.length && assets.length) ? { table: table(['Code', 'Asset', 'With', 'Status'], assets.map((a) => [a.code, a.name, holder(a), COMPANY_ASSET_STATUS_LABELS[a.status as CompanyAssetStatus] ?? a.status]), 15) } : {}),
        links: [{ label: 'Company assets', href: '/hr/assets' }],
      };
    },
  },
];
