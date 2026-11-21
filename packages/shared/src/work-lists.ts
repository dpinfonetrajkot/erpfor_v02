/**
 * The work lists of "Work waiting for you" (dashboard and Ask ERP): what the count means and
 * which screen opens it. Keys match the API's dashboard tasks.
 */
export const WORK_LISTS = [
  { key: 'overdueInvoices', label: 'Overdue invoices', href: '/billing/payments', urgent: true },
  { key: 'soFeasibility', label: 'Orders for feasibility', href: '/sales/orders?awaiting=FEASIBILITY' },
  { key: 'soDesign', label: 'Orders for design approval', href: '/sales/orders?awaiting=DESIGN' },
  { key: 'soProduction', label: 'Orders for production approval', href: '/sales/orders?awaiting=PRODUCTION' },
  { key: 'soToPlan', label: 'Approved orders to plan', href: '/sales/orders?status=APPROVED' },
  { key: 'rcAtMyStages', label: 'Route cards at your stages', href: '/production/route-cards?mine=true' },
  { key: 'productionRequests', label: 'Requests to plan (route card)', href: '/production/requests?status=REQUESTED' },
  { key: 'mrToIssue', label: 'Material to issue', href: '/store/material-issue' },
  { key: 'completionsToMove', label: 'Finished parts to put in FG store', href: '/store/rc-completion' },
  { key: 'jwToPlan', label: 'Outsourced products without job work order', href: '/sales/orders?status=OPEN' },
  { key: 'jwMaterialToSend', label: 'Material to send to vendors', href: '/store/material-issue?for=jw' },
  { key: 'jwToReceive', label: 'Job work orders with vendors', href: '/job-work/orders?status=RUNNING' },
  { key: 'toPack', label: 'Orders with sets to pack', href: '/sales/orders?status=OPEN' },
  { key: 'toInvoice', label: 'Packed sets to invoice', href: '/dispatch/packing?status=PACKED' },
  { key: 'invoicesToIssue', label: 'Draft invoices to issue', href: '/billing/invoices?status=DRAFT' },
  { key: 'toDispatch', label: 'Invoices to dispatch', href: '/billing/invoices?status=ISSUED' },
  { key: 'poToApprove', label: 'POs to approve', href: '/purchase/orders?status=DRAFT' },
  { key: 'prPending', label: 'Requisitions to order', href: '/purchase/requisitions?status=PENDING' },
  { key: 'grnPendingQc', label: 'Waiting for QC', href: '/quality/incoming-qc' },
  { key: 'poOpen', label: 'Open POs (to receive)', href: '/purchase/orders?status=OPEN' },
  { key: 'leavesToApprove', label: 'Leave to approve', href: '/hr/leaves?status=PENDING' },
  { key: 'punchesToFix', label: 'Days with a missing punch (last 7 days)', href: '/hr/attendance' },
  { key: 'unknownCodes', label: 'Unknown codes on the machine', href: '/hr/attendance?tab=machines' },
  { key: 'devicesWaiting', label: 'Machines waiting for approval', href: '/hr/attendance?tab=machines' },
  { key: 'safetyDue', label: 'Safety checks due in 15 days', href: '/hr/assets?tab=safety&due=true', urgent: true },
  { key: 'payrollToPrepare', label: 'Payroll of {month} to prepare', href: '/hr/payroll?month={month}' },
  { key: 'draftPayrolls', label: 'Payroll drafts to finalize', href: '/hr/payroll' },
] as const satisfies readonly { key: string; label: string; href: string; urgent?: boolean }[];

export type WorkListKey = (typeof WORK_LISTS)[number]['key'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Label and link with the payroll month filled in ("Payroll of October 2026 to prepare"). */
export function workListText(list: (typeof WORK_LISTS)[number], payrollMonth: string): { label: string; href: string } {
  const name = `${MONTHS[Number(payrollMonth.slice(5, 7)) - 1] ?? ''} ${payrollMonth.slice(0, 4)}`.trim();
  return { label: list.label.replace('{month}', name), href: list.href.replace('{month}', payrollMonth) };
}
