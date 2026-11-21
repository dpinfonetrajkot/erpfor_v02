import PDFDocument from 'pdfkit';
import { amountInWords, fmtHours, INDIAN_STATES } from '@bht/shared';
import type { Company } from '../generated/prisma/client';
import type { PayslipFull } from './payroll.service';
import { brand } from '../config/brand';

const MARGIN = 36;
const WIDTH = 595.28 - MARGIN * 2;
const HALF = 841.89 / 2;
const ACCENT = '#c2410c';
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#d1d5db';

const money = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const n = (v: { toString(): string } | number | null | undefined) => (v == null ? 0 : Number(v.toString()));
const dmy = (d: Date | null | undefined) => (d ? `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}` : '-');
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const stateName = (code: string | null) => INDIAN_STATES.find((s) => s.code === code)?.name;
/** Only the last 4 digits of the bank account are printed. */
const masked = (acc: string | null) => (acc ? `XXXX${acc.slice(-4)}` : '-');

/** Payslips, two per A4 page (cut along the dashed line). */
export function renderPayslipsPdf(run: { month: string; monthDays: number }, payslips: PayslipFull[], company: Company | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: MARGIN, bottom: 10, left: MARGIN, right: MARGIN }, info: { Title: `Payslips ${run.month}`, Author: company?.name ?? brand().name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    payslips.forEach((p, i) => {
      if (i > 0 && i % 2 === 0) doc.addPage();
      const top = i % 2 === 0 ? MARGIN : HALF + 20;
      if (i % 2 === 1) {
        doc.moveTo(MARGIN, HALF).lineTo(MARGIN + WIDTH, HALF).dash(4, { space: 4 }).lineWidth(0.5).strokeColor(LINE).stroke().undash();
      }
      drawPayslip(doc, top, run, p, company);
    });
    if (!payslips.length) doc.font('Helvetica').fontSize(10).text('No payslips.', MARGIN, MARGIN);
    doc.end();
  });
}

function drawPayslip(doc: PDFKit.PDFDocument, top: number, run: { month: string; monthDays: number }, p: PayslipFull, company: Company | null) {
  const e = p.employee;
  // header
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(company?.legalName || company?.name || brand().name, MARGIN, top, { width: WIDTH * 0.65 });
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text([company?.address, company?.city, stateName(company?.stateCode ?? null), company?.pincode].filter(Boolean).join(', '), { width: WIDTH * 0.65 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ACCENT).text('PAYSLIP', MARGIN, top, { width: WIDTH, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(monthName(run.month), { width: WIDTH, align: 'right' });
  let y = top + 34;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + WIDTH, y).lineWidth(1).strokeColor(ACCENT).stroke();
  y += 8;

  // employee + attendance facts
  const facts: [string, string][] = [
    ['Employee', `${e.empCode} - ${e.name}`],
    ['Designation', [e.designation, e.department?.name].filter(Boolean).join(' · ') || '-'],
    ['Joined', dmy(e.dateOfJoining)],
    ['Bank', e.bankAccountNo ? `${e.bankName ?? ''} ${masked(e.bankAccountNo)}`.trim() : 'Cash'],
    ['UAN', e.uan ?? '-'],
    ['Month days', String(run.monthDays)],
    ['Present', `${num.format(n(p.presentDays))} day(s)`],
    ['Paid leave', `${num.format(n(p.paidLeaveDays))} day(s)`],
    ['Payable days', num.format(n(p.payableDays))],
    ['Absent', num.format(n(p.absentDays))],
    ['Hours', `${fmtHours(n(p.hoursWorked))} of ${fmtHours(n(p.expectedHours))} (${num.format(n(p.shiftHours))} h shift)`],
    ['Sundays worked', String(p.sundaysWorked)],
  ];
  const colW = WIDTH / 3;
  facts.forEach(([k, v], i) => {
    const x = MARGIN + (i % 3) * colW;
    const yy = y + Math.floor(i / 3) * 22;
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text(k.toUpperCase(), x, yy, { width: colW - 6, characterSpacing: 0.3 });
    doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(v, x, yy + 8, { width: colW - 6, lineBreak: false, ellipsis: true });
  });
  y += Math.ceil(facts.length / 3) * 22 + 6;

  // earnings | deductions
  const other = n(p.otherAdjustment);
  const earnings: [string, number][] = [
    [`Basic ${money.format(n(p.basicSalary))} / ${run.monthDays} x ${num.format(n(p.payableDays))} days`, n(p.baseEarning)],
    [`Hours ${n(p.hourDifference) >= 0 ? 'extra' : 'short'} ${fmtHours(Math.abs(n(p.hourDifference)))}`, n(p.hourAdjustment)],
    ...(other > 0 ? ([[p.adjustmentNote || 'Other', other]] as [string, number][]) : []),
  ];
  const deductions: [string, number][] = [
    ...(p.isPfEligible ? ([['Provident fund (PF)', n(p.pfDeduction)]] as [string, number][]) : []),
    ...(n(p.loanDeduction) ? ([['Loan / advance EMI', n(p.loanDeduction)]] as [string, number][]) : []),
    ...(other < 0 ? ([[p.adjustmentNote || 'Other', -other]] as [string, number][]) : []),
  ];
  const half = (WIDTH - 12) / 2;
  const table = (x: number, title: string, rows: [string, number][], total: [string, number]) => {
    let yy = y;
    doc.rect(x, yy, half, 15).fill('#f3f4f6');
    doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED).text(title, x + 5, yy + 4.5, { width: half - 10, characterSpacing: 0.4 });
    yy += 17;
    for (const [k, v] of rows) {
      doc.font('Helvetica').fontSize(8).fillColor(INK).text(k, x + 5, yy, { width: half - 80 });
      doc.text(money.format(v), x + half - 75, yy, { width: 70, align: 'right' });
      yy += 13;
    }
    yy = Math.max(yy, y + 17 + 3 * 13);
    doc.moveTo(x, yy).lineTo(x + half, yy).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(total[0], x + 5, yy + 4, { width: half - 80 });
    doc.text(money.format(total[1]), x + half - 75, yy + 4, { width: 70, align: 'right' });
    return yy + 18;
  };
  const gross = n(p.grossEarning) + Math.max(0, other);
  const totalDed = n(p.pfDeduction) + n(p.loanDeduction) + Math.max(0, -other);
  const end1 = table(MARGIN, 'EARNINGS', earnings, ['Total earnings', gross]);
  const end2 = table(MARGIN + half + 12, 'DEDUCTIONS', deductions.length ? deductions : [['None', 0]], ['Total deductions', totalDed]);
  y = Math.max(end1, end2) + 4;

  // net pay
  doc.rect(MARGIN, y, WIDTH, 30).fill('#fff7ed');
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('NET PAY', MARGIN + 8, y + 6);
  doc.text(`Rs. ${money.format(n(p.netSalary))}`, MARGIN + WIDTH - 208, y + 6, { width: 200, align: 'right' });
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(amountInWords(n(p.netSalary), 'INR'), MARGIN + 8, y + 18, { width: WIDTH - 16 });
  y += 38;
  const loanLeft = p.loanRepayments.reduce((s, r) => s + n(r.loan.balance), 0);
  const notes = [
    n(p.roundOff) ? `Rounded off by ${money.format(n(p.roundOff))}.` : null,
    p.loanRepayments.length ? `Loan / advance still to repay after this month: Rs. ${money.format(loanLeft)}.` : null,
    'Computer generated payslip.',
  ].filter(Boolean);
  doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(notes.join('  '), MARGIN, y, { width: WIDTH * 0.6 });
  doc.moveTo(MARGIN + WIDTH - 150, y + 18).lineTo(MARGIN + WIDTH, y + 18).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.text('Employee signature', MARGIN + WIDTH - 150, y + 21, { width: 150, align: 'right' });
}
