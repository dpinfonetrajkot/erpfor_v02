import { z } from 'zod';
import { id, number, optionalDate, optionalEmail, optionalId, optionalNumber, optionalPhone, optionalText, text } from './common';
import { PAYMENT_MODES } from './billing';

// ---------------------------------------------------------------- dates

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date');
/** "2026-11" */
export const monthString = () => z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month like 2026-11');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Time like 09:05');

/** Sunday is the weekly off: not a working day, not counted as present, not counted in leave. */
export const isSunday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;

/** Every date of a month, "YYYY-MM-DD". */
export function monthDates(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** Leave days between two dates (inclusive) without Sundays; a half day counts 0.5. */
export function leaveDays(from: string, to: string, isHalfDay = false): number {
  if (isHalfDay) return isSunday(from) ? 0 : 0.5;
  let n = 0;
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0) n++;
  }
  return n;
}

/** Hours from punches taken in pairs (IN-OUT, IN-OUT ...); an odd last punch has no pair and is flagged. */
export function pairHours(punches: string[]): { hours: number; missingPunch: boolean } {
  const mins = [...punches].sort().map((t) => {
    const [h, m, s] = t.split(':').map(Number);
    return h * 60 + m + (s || 0) / 60;
  });
  let total = 0;
  for (let i = 0; i + 1 < mins.length; i += 2) total += mins[i + 1] - mins[i];
  return { hours: Math.round((total / 60) * 100) / 100, missingPunch: mins.length % 2 === 1 };
}

/** 9.75 -> "9h 45m" */
export function fmtHours(hours: number): string {
  const sign = hours < 0 ? '-' : '';
  const total = Math.round(Math.abs(hours) * 60);
  return `${sign}${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

// ---------------------------------------------------------------- employees

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export const GENDER_LABELS: Record<(typeof GENDERS)[number], string> = { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' };
export const EMPLOYEE_STATUSES = ['ACTIVE', 'LEFT'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = { ACTIVE: 'Working', LEFT: 'Left' };
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const employeeSchema = z
  .object({
    empCode: text(30).regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and - only (the code on the biometric machine)'),
    name: text(100),
    gender: z.enum(GENDERS),
    dateOfBirth: optionalDate(),
    dateOfJoining: optionalDate(),
    departmentId: optionalId(),
    designation: optionalText(100),
    phone: optionalPhone(),
    email: optionalEmail(),
    address: optionalText(500),
    basicSalary: number(0).max(10_000_000),
    ctc: optionalNumber(0),
    shiftHours: number(1).max(24),
    isPfEligible: z.boolean(),
    uan: optionalText(20),
    bankName: optionalText(100),
    bankAccountNo: optionalText(30),
    bankIfsc: z.union([z.literal(''), z.string().trim().toUpperCase().regex(IFSC_REGEX, 'Invalid IFSC')]).optional(),
    status: z.enum(EMPLOYEE_STATUSES),
    leftOn: optionalDate(),
  })
  .refine((v) => v.status !== 'LEFT' || !!v.leftOn, { path: ['leftOn'], message: 'Date of leaving is needed' });
export type EmployeeInput = z.infer<typeof employeeSchema>;

export const departmentSchema = z.object({ name: text(100) });
export type DepartmentInput = z.infer<typeof departmentSchema>;

// ---------------------------------------------------------------- attendance

export const ATTENDANCE_SOURCE_LABELS = { DEVICE: 'Machine', MANUAL: 'Corrected by hand', IMPORT: 'CSV import' } as const;

/** Typed / corrected punches of one employee for one day (empty list = remove the day). */
export const attendanceDaySchema = z.object({
  employeeId: id(),
  date: ymd,
  punches: z.array(hhmm).max(12, 'At most 12 punches a day'),
  remarks: optionalText(255),
});
export type AttendanceDayInput = z.infer<typeof attendanceDaySchema>;

/** One row of a machine CSV export, after the preview. */
export const attendanceImportSchema = z.object({
  rows: z
    .array(z.object({ empCode: text(50), date: ymd, punches: z.array(hhmm).max(12) }))
    .min(1, 'Nothing to import')
    .max(10_000),
});
export type AttendanceImportInput = z.infer<typeof attendanceImportSchema>;

/** Either field alone: renaming and approving are separate clicks and must not undo each other. */
export const deviceSchema = z.object({ name: optionalText(100), isApproved: z.boolean().optional() });
export type DeviceInput = z.infer<typeof deviceSchema>;

// ---------------------------------------------------------------- leaves

export const LEAVE_TYPES = ['CL', 'SL', 'EL', 'LWP'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = { CL: 'Casual leave', SL: 'Sick leave', EL: 'Earned leave', LWP: 'Leave without pay' };
/** These are paid and use the yearly balance. */
export const PAID_LEAVE_TYPES: LeaveType[] = ['CL', 'SL', 'EL'];
export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };

export const leaveSchema = z
  .object({
    employeeId: id(),
    type: z.enum(LEAVE_TYPES),
    fromDate: ymd,
    toDate: ymd,
    isHalfDay: z.boolean(),
    reason: text(500),
    /** Users who may approve leaves can save it approved straight away (as in the old ERP). */
    approveNow: z.boolean().optional(),
  })
  .refine((v) => v.toDate >= v.fromDate, { path: ['toDate'], message: 'Must be on or after the from date' })
  .refine((v) => !v.isHalfDay || v.fromDate === v.toDate, { path: ['isHalfDay'], message: 'A half day is a single date' })
  .refine((v) => leaveDays(v.fromDate, v.toDate, v.isHalfDay) > 0, { path: ['toDate'], message: 'Only Sundays chosen - nothing to take' });
export type LeaveInput = z.infer<typeof leaveSchema>;

export const leaveDecisionSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), remark: optionalText(500) });
export type LeaveDecisionInput = z.infer<typeof leaveDecisionSchema>;

const leaveQuota = () => number(0).max(365);
export const leaveBalanceSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  casual: leaveQuota(),
  sick: leaveQuota(),
  earned: leaveQuota(),
  /** Set for these employees; empty = every working employee */
  employeeIds: z.array(z.coerce.number().int().positive()).max(2000).optional(),
});
export type LeaveBalanceInput = z.infer<typeof leaveBalanceSchema>;

// ---------------------------------------------------------------- loans

export const LOAN_TYPES = ['ADVANCE', 'PERSONAL_LOAN'] as const;
export type LoanType = (typeof LOAN_TYPES)[number];
export const LOAN_TYPE_LABELS: Record<LoanType, string> = { ADVANCE: 'Salary advance', PERSONAL_LOAN: 'Personal loan' };
export const LOAN_STATUSES = ['ACTIVE', 'PAUSED', 'CLOSED'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];
export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = { ACTIVE: 'EMI running', PAUSED: 'Paused (no EMI)', CLOSED: 'Closed' };

export const loanSchema = z
  .object({
    employeeId: id(),
    type: z.enum(LOAN_TYPES),
    amount: number(1).max(10_000_000),
    emiAmount: number(1).max(10_000_000),
    startMonth: monthString(),
    disbursementMode: z.enum(PAYMENT_MODES),
    disbursementRef: optionalText(100),
    reason: optionalText(255),
  })
  .refine((v) => v.emiAmount <= v.amount, { path: ['emiAmount'], message: 'EMI cannot be more than the loan' });
export type LoanInput = z.infer<typeof loanSchema>;

/** The balance only changes through repayments (salary or cash). */
export const loanUpdateSchema = z.object({
  emiAmount: number(1).max(10_000_000),
  status: z.enum(['ACTIVE', 'PAUSED']),
  reason: optionalText(255),
});
export type LoanUpdateInput = z.infer<typeof loanUpdateSchema>;

export const loanRepaymentSchema = z.object({
  date: ymd,
  amount: number(1).max(10_000_000),
  mode: z.enum(PAYMENT_MODES),
  remarks: optionalText(255),
});
export type LoanRepaymentInput = z.infer<typeof loanRepaymentSchema>;

// ---------------------------------------------------------------- payroll

export const PAYROLL_STATUSES = ['DRAFT', 'FINALIZED', 'PAID'] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];
export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = { DRAFT: 'Draft', FINALIZED: 'Finalized', PAID: 'Paid' };

/** Same defaults as the old ERP: 26 working days a month, PF 12% of basic. */
export const DEFAULT_PAYROLL_SETTINGS = { monthDays: 26, pfPercent: 12 };
export const payrollSettingsSchema = z.object({
  monthDays: z.coerce.number().int().min(20, 'At least 20').max(31, 'At most 31'),
  pfPercent: z.coerce.number().min(0).max(30),
});
export type PayrollSettingsInput = z.infer<typeof payrollSettingsSchema>;

export const payrollAdjustSchema = z
  .object({
    otherAdjustment: z.coerce.number({ error: 'Must be a number' }).min(-10_000_000).max(10_000_000),
    adjustmentNote: optionalText(255),
  })
  .refine((v) => v.otherAdjustment === 0 || !!v.adjustmentNote?.trim(), { path: ['adjustmentNote'], message: 'Say what the amount is for' });
export type PayrollAdjustInput = z.infer<typeof payrollAdjustSchema>;

export const payrollPaidSchema = z.object({ paidOn: ymd, paymentRef: optionalText(100) });
export type PayrollPaidInput = z.infer<typeof payrollPaidSchema>;

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface SalaryInput {
  basicSalary: number;
  monthDays: number;
  shiftHours: number;
  /** Days with punches, Sundays not counted */
  presentDays: number;
  /** Approved CL / SL / EL on days without punches */
  paidLeaveDays: number;
  /** Hours on the present days */
  hoursWorked: number;
  isPfEligible: boolean;
  pfPercent: number;
  /** Running loans in the order their EMI is taken */
  loans: { loanId: number; emi: number; balance: number }[];
  otherAdjustment: number;
}

/**
 * The salary formula of the old ERP, plus paid leave:
 * day rate = basic / month days; base = day rate x payable days (present + paid leave, at most the month days);
 * hours: (worked - present days x shift hours) x day rate / shift hours, plus or minus;
 * PF = basic x PF% / month days x payable days; loan EMIs only from what is left; net rounded to the rupee.
 */
export function computeSalary(i: SalaryInput) {
  const present = Math.min(i.presentDays, i.monthDays);
  const payableDays = Math.min(present + i.paidLeaveDays, i.monthDays);
  const absentDays = Math.max(0, i.monthDays - payableDays);
  const dayRate = i.monthDays > 0 ? i.basicSalary / i.monthDays : 0;
  const baseEarning = r2(dayRate * payableDays);
  const expectedHours = r2(present * i.shiftHours);
  const hourDifference = r2(i.hoursWorked - expectedHours);
  const hourlyRate = i.shiftHours > 0 ? dayRate / i.shiftHours : 0;
  const hourAdjustment = r2(hourDifference * hourlyRate);
  const grossEarning = Math.max(0, r2(baseEarning + hourAdjustment));
  const pfDeduction = i.isPfEligible ? r2(((i.basicSalary * i.pfPercent) / 100 / i.monthDays) * payableDays) : 0;
  let left = Math.max(0, r2(grossEarning - pfDeduction + i.otherAdjustment));
  const loanDeductions = i.loans
    .map((l) => {
      const amount = r2(Math.min(l.emi, l.balance, left));
      left = r2(left - amount);
      return { loanId: l.loanId, amount };
    })
    .filter((l) => l.amount > 0);
  const loanDeduction = r2(loanDeductions.reduce((s, l) => s + l.amount, 0));
  const exact = r2(grossEarning - pfDeduction - loanDeduction + i.otherAdjustment);
  const netSalary = Math.round(exact);
  return {
    presentDays: present,
    paidLeaveDays: i.paidLeaveDays,
    payableDays,
    absentDays,
    dayRate: r2(dayRate),
    baseEarning,
    expectedHours,
    hourDifference,
    hourAdjustment,
    grossEarning,
    pfDeduction,
    loanDeductions,
    loanDeduction,
    roundOff: r2(netSalary - exact),
    netSalary,
  };
}

// ---------------------------------------------------------------- assets

export const COMPANY_ASSET_STATUSES = ['IN_USE', 'IN_STORE', 'UNDER_REPAIR', 'SCRAPPED'] as const;
export type CompanyAssetStatus = (typeof COMPANY_ASSET_STATUSES)[number];
export const COMPANY_ASSET_STATUS_LABELS: Record<CompanyAssetStatus, string> = { IN_USE: 'In use', IN_STORE: 'In store', UNDER_REPAIR: 'Under repair', SCRAPPED: 'Scrapped' };

export const companyAssetSchema = z.object({
  code: text(30),
  name: text(200),
  category: optionalText(100),
  department: optionalText(100),
  employeeId: optionalId(),
  status: z.enum(COMPANY_ASSET_STATUSES),
  assignDate: optionalDate(),
  returnDate: optionalDate(),
  warrantyDate: optionalDate(),
  remarks: optionalText(500),
});
export type CompanyAssetInput = z.infer<typeof companyAssetSchema>;

export const SAFETY_ASSET_STATUSES = ['OK', 'FAULTY', 'OUT_OF_SERVICE'] as const;
export type SafetyAssetStatus = (typeof SAFETY_ASSET_STATUSES)[number];
export const SAFETY_ASSET_STATUS_LABELS: Record<SafetyAssetStatus, string> = { OK: 'OK', FAULTY: 'Faulty', OUT_OF_SERVICE: 'Out of service' };

export const safetyAssetSchema = z.object({
  code: text(30),
  name: text(200),
  locationZone: optionalText(150),
  typeCapacity: optionalText(150),
  installationDate: optionalDate(),
  lastInspectionDate: optionalDate(),
  nextDueDate: optionalDate(),
  lastServiceDate: optionalDate(),
  inspectionIntervalDays: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().min(1).max(3650).optional()),
  vendorAgency: optionalText(200),
  status: z.enum(SAFETY_ASSET_STATUSES),
  remarks: optionalText(500),
});
export type SafetyAssetInput = z.infer<typeof safetyAssetSchema>;

/** Recording an inspection: next due = date + interval unless given. */
export const inspectionSchema = z.object({
  date: ymd,
  nextDueDate: optionalDate(),
  status: z.enum(SAFETY_ASSET_STATUSES),
  remarks: optionalText(500),
});
export type InspectionInput = z.infer<typeof inspectionSchema>;
