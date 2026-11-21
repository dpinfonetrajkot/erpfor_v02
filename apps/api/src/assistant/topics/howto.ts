import { has, type Parsed } from '../language';
import type { Topic } from '../kit';

/**
 * "How do I ...?" - short step-by-step guides for the ERP's own screens.
 * `words`: what the question must mention (scored by how many match); `strong`: words that pick this guide over a near one.
 */
interface Guide {
  title: string;
  words: string[];
  strong?: string[];
  steps: string[];
  link: { label: string; href: string };
  tip?: string;
}

const GUIDES: Guide[] = [
  {
    title: 'Create a sales order',
    words: ['so', 'order', 'customer order', 'new order', 'booking'],
    strong: ['so', 'customer order'],
    steps: [
      'Open Sales → Sales Orders and click "New sales order".',
      'Choose the customer, enter the customer PO no. and date, and the delivery date.',
      'Add each product with sets, end connection, service (STD / SOUR), material grade and rate.',
      'Save the order, then click "Send for approval".',
      'It is approved in order: feasibility → design → production. Each approver sees it on the dashboard.',
    ],
    link: { label: 'Sales orders', href: '/sales/orders' },
    tip: 'After approval use "Stock check" to see what is in stock and what must be made or outsourced.',
  },
  {
    title: 'Approve a sales order',
    words: ['approve', 'approval', 'feasibility', 'design approval', 'production approval'],
    strong: ['approve', 'feasibility', 'design approval', 'production approval', 'approve so', 'approve order'],
    steps: [
      'Open the Dashboard - "Orders for feasibility / design / production approval" shows what waits for you.',
      'Open the order and check the lines and drawings.',
      'Click "Approve" (or reject with a reason). The next approver is told automatically.',
    ],
    link: { label: 'Orders waiting', href: '/sales/orders?awaiting=FEASIBILITY' },
  },
  {
    title: 'Plan production (route card)',
    words: ['rc', 'production', 'plan', 'planning', 'make route card', 'job card', 'stock check'],
    strong: ['rc', 'make route card', 'job card'],
    steps: [
      'Open the approved sales order and click "Stock check".',
      'For parts to make, a production request is created. Open Production → Production Requests.',
      'Click "Make route card", choose the stages (forging, machining, PDI ...) and the quantity, then save.',
      'Print the route card PDF for the shop floor.',
    ],
    link: { label: 'Production requests', href: '/production/requests' },
  },
  {
    title: 'Update a route card stage',
    words: ['stage', 'stages', 'update rc', 'ok qty', 'rejection', 'forging done', 'machining done'],
    strong: ['stage', 'stages'],
    steps: [
      'Open Production → Route Cards (the Dashboard shows "Route cards at your stages").',
      'Open the card and the stage that is your work.',
      'Enter the OK and rejected pieces (with the rejection reason), weights or the material check result, then save.',
      'The next stage opens; after the last stage a completion slip is made for the store.',
    ],
    link: { label: 'Route cards', href: '/production/route-cards?mine=true' },
  },
  {
    title: 'Issue raw material to a route card',
    words: ['issue material', 'material issue', 'issue', 'bar', 'heat issue', 'material request'],
    strong: ['material issue', 'issue material'],
    steps: [
      'Open Store → Material Issue. Material requests from route cards are listed.',
      'Open the request, choose the heat(s) to issue from and enter the kg / bars.',
      'Click "Issue". Stock moves from the RM store to work in progress, by heat.',
    ],
    link: { label: 'Material issue', href: '/store/material-issue' },
    tip: 'Unused material goes back with "Return to store".',
  },
  {
    title: 'Put finished parts in the FG store',
    words: ['fg', 'finished', 'completion', 'fg store', 'put in fg', 'finished parts'],
    strong: ['fg', 'completion'],
    steps: ['Open Store → Finished Parts In.', 'Open the completion slip of the route card.', 'Click "Put in FG store". Stock is added to the FG store by heat.'],
    link: { label: 'Finished parts in', href: '/store/rc-completion' },
  },
  {
    title: 'Give work to a job worker (job work)',
    words: ['jwo', 'job work', 'outsource', 'vendor work', 'job worker'],
    strong: ['jwo', 'job work', 'outsource'],
    steps: [
      'Open Job Work → Job Work Orders and click "New job work order".',
      'Choose the vendor, the parts and quantities, and the material to send.',
      'Store sends the material from Store → Material Issue (it shows "Material to send to vendors").',
      'When parts come back, record them in Job Work → Job Work Receipts with the QC result.',
    ],
    link: { label: 'Job work orders', href: '/job-work/orders' },
  },
  {
    title: 'Receive material (gate entry)',
    words: ['grn', 'gate entry', 'receive', 'inward', 'material came', 'goods receipt'],
    strong: ['grn', 'gate entry', 'inward'],
    steps: [
      'Open Store → Gate Entry and click "New gate entry".',
      'Choose the supplier and the purchase order, enter the challan / invoice no. and vehicle.',
      'Enter the quantity received for each line with its heat number and mill TC, then save.',
      'The entry goes to Quality → Incoming QC before it reaches stock.',
    ],
    link: { label: 'Gate entry', href: '/store/gate-entry' },
  },
  {
    title: 'Do incoming QC',
    words: ['qc', 'quality', 'inspection', 'incoming qc', 'accept', 'reject material'],
    strong: ['qc', 'incoming qc'],
    steps: [
      'Open Quality → Incoming QC. Gate entries waiting for QC are listed.',
      'Open one, check the material and test certificate.',
      'Enter the accepted and rejected quantity and click "Save QC result". Accepted material goes to the RM store.',
    ],
    link: { label: 'Incoming QC', href: '/quality/incoming-qc' },
  },
  {
    title: 'Raise a purchase requisition',
    words: ['requisition', 'pr', 'indent', 'material request', 'need material'],
    strong: ['requisition', 'indent'],
    steps: ['Open Purchase → Requisitions and click "New requisition".', 'Choose the raw material, quantity and the date it is needed, then save.', 'Purchase makes a PO from it.'],
    link: { label: 'Requisitions', href: '/purchase/requisitions' },
  },
  {
    title: 'Make a purchase order',
    words: ['po', 'purchase', 'buy', 'order material', 'supplier order'],
    strong: ['po', 'purchase'],
    steps: [
      'Open Purchase → Purchase Orders and click "New purchase order" (or select requisitions and make a PO from them).',
      'Choose the supplier, add materials with quantity and rate, GST and terms.',
      'Save as draft, then approve it. Print or e-mail the PO PDF to the supplier.',
    ],
    link: { label: 'Purchase orders', href: '/purchase/orders' },
  },
  {
    title: 'Pack sets for an order',
    words: ['pack', 'packing', 'assembly', 'assemble', 'box'],
    strong: ['pack', 'packing'],
    steps: [
      'Open Dispatch & Billing → Packing and click "Pack sets".',
      'Choose the sales order and the sets to pack.',
      'For each part choose the heats it comes from (this keeps heat traceability), enter packing type, boxes and weight, then save.',
    ],
    link: { label: 'Packing', href: '/dispatch/packing' },
  },
  {
    title: 'Make an invoice from packed sets',
    words: ['invoice', 'bill', 'billing', 'tax invoice', 'make invoice', 'packed'],
    strong: ['invoice', 'bill'],
    steps: [
      'Open Dispatch & Billing → Packing and open the packing (status "Packed").',
      'Click "Make invoice". A draft invoice opens with the customer, sets and rates of the order.',
      'Check the company (GSTIN), dates, GST and freight, then "Save draft".',
      'Click "Issue invoice" - it gets the next number of the company series and the PDF is ready.',
    ],
    link: { label: 'Packed sets to invoice', href: '/dispatch/packing?status=PACKED' },
    tip: 'For services, scrap or job work charges without a packing, ask "how to make a direct invoice".',
  },
  {
    title: 'Make a direct invoice (without packing)',
    words: ['direct invoice', 'new invoice', 'service invoice', 'scrap', 'without packing', 'manual invoice', 'job work charges'],
    strong: ['direct invoice', 'without packing', 'service invoice', 'manual invoice', 'scrap', 'new invoice'],
    steps: [
      'Open Dispatch & Billing → Invoices and click "New invoice".',
      'Choose the customer - address, GSTIN, GST type and due date fill in by themselves.',
      'Type each line: description, HSN / SAC, quantity, unit and rate. Use "Add line" for more.',
      'Click "Save draft invoice", check it, then "Issue invoice".',
    ],
    link: { label: 'New invoice', href: '/billing/invoices/new' },
    tip: 'A direct invoice does not change stock. For sets of a sales order use Packing → Make invoice.',
  },
  {
    title: 'Dispatch goods',
    words: ['dispatch', 'dc', 'challan', 'transport', 'lr', 'truck', 'send goods'],
    strong: ['dispatch', 'challan', 'lr'],
    steps: [
      'Open the issued invoice (Dispatch & Billing → Invoices).',
      'Click "Dispatch" and enter the transporter, LR no., vehicle, driver, boxes and weight.',
      'Save. Print the packing list PDF for the truck.',
    ],
    link: { label: 'Invoices to dispatch', href: '/billing/invoices?status=ISSUED' },
  },
  {
    title: 'Record a payment from a customer',
    words: ['payment received', 'receive payment', 'receipt', 'customer paid', 'collection', 'money received'],
    strong: ['payment received', 'receive payment', 'customer paid', 'receipt'],
    steps: ['Open the invoice (Dispatch & Billing → Invoices).', 'Click "Payment received".', 'Enter date, amount, mode (bank / UPI / cheque / cash) and reference no., then save.'],
    link: { label: 'Payments', href: '/billing/payments' },
  },
  {
    title: 'Record a payment to a supplier',
    words: ['pay supplier', 'supplier payment', 'payment made', 'vendor payment', 'pay vendor'],
    strong: ['pay supplier', 'supplier payment', 'vendor payment', 'payment made'],
    steps: ['Open Dispatch & Billing → Payments, tab "We owe suppliers".', 'Choose the purchase order and click to record the payment.', 'Enter date, amount, mode and reference, then save.'],
    link: { label: 'We owe suppliers', href: '/billing/payments?tab=owe' },
  },
  {
    title: 'Add a customer',
    words: ['customer', 'add customer', 'new customer', 'client', 'party'],
    strong: ['add customer', 'new customer'],
    steps: ['Open Masters → Customers and click "New customer".', 'Enter the name, GSTIN, address with state, contact person, phone, e-mail and payment terms (days).', 'Save.'],
    link: { label: 'Customers', href: '/masters/customers' },
  },
  {
    title: 'Add a supplier or vendor',
    words: ['supplier', 'vendor', 'add supplier', 'new supplier', 'add vendor'],
    strong: ['add supplier', 'new supplier', 'add vendor'],
    steps: ['Open Masters → Suppliers & Vendors and click "New supplier".', 'Choose the type (material / job work), enter GSTIN, address, contact and bank details.', 'Save.'],
    link: { label: 'Suppliers & vendors', href: '/masters/suppliers' },
  },
  {
    title: 'Add an employee',
    words: ['employee', 'add employee', 'new employee', 'worker', 'staff', 'joining'],
    strong: ['add employee', 'new employee'],
    steps: [
      'Open HR & Payroll → Employees and click "New employee".',
      'Enter the code (same as the biometric machine user no.), name, department, joining date.',
      'Enter basic salary, shift hours, PF details and bank account, then save.',
    ],
    link: { label: 'Employees', href: '/hr/employees' },
  },
  {
    title: 'Check or fix attendance',
    words: ['attendance', 'punch', 'missing punch', 'biometric', 'import attendance', 'machine'],
    strong: ['attendance', 'punch', 'biometric'],
    steps: [
      'Open HR & Payroll → Attendance. Punches come from the biometric machine by themselves.',
      'Use the day view to see who is present, absent or has a missing punch.',
      'Add a missing punch on the employee\'s day, or bring old data with "Import" (CSV).',
    ],
    link: { label: 'Attendance', href: '/hr/attendance' },
  },
  {
    title: 'Record or approve leave',
    words: ['leave', 'cl', 'sl', 'el', 'chutti', 'holiday', 'record leave'],
    strong: ['leave', 'record leave'],
    steps: ['Open HR & Payroll → Leaves and click "Record leave".', 'Choose the employee, leave type (CL / SL / EL / without pay) and dates, then save.', 'The approver approves it from the same screen (Dashboard: "Leave to approve").'],
    link: { label: 'Leaves', href: '/hr/leaves' },
  },
  {
    title: 'Prepare the monthly payroll',
    words: ['payroll', 'salary', 'payslip', 'prepare payroll', 'finalize', 'pagar'],
    strong: ['payroll', 'salary', 'payslip'],
    steps: [
      'Check that attendance and leave of the month are complete.',
      'Open HR & Payroll → Payroll, choose the month and click "Prepare payroll".',
      'Check the draft (days, overtime, loan EMI, PF), then "Finalize" - this locks the month.',
      'After paying, click "Mark salaries paid". Payslip PDFs are on each row.',
    ],
    link: { label: 'Payroll', href: '/hr/payroll' },
  },
  {
    title: 'Trace a heat or an order',
    words: ['trace', 'traceability', 'heat', 'mtc', 'mill', 'certificate'],
    strong: ['trace', 'traceability'],
    steps: [
      'Open Reports → Traceability.',
      'Search a heat no., mill heat no., sales order, invoice or dispatch number.',
      'The report shows the whole chain: supplier & mill TC → route cards → packing → invoice → customer. Download it as PDF.',
    ],
    link: { label: 'Traceability', href: '/reports/traceability' },
  },
  {
    title: 'Add a user or change a password',
    words: ['user', 'login', 'password', 'new user', 'add user', 'reset password', 'role', 'permission'],
    strong: ['user', 'password', 'login'],
    steps: [
      'Admins: open Admin → Users and click "New user" - give a username, password and role.',
      'To reset someone\'s password, open the user and set a new one.',
      'To change your own password: click your name at the top right → My Account.',
    ],
    link: { label: 'Users', href: '/admin/users' },
  },
];

const HOW = ['how to', 'how do i', 'how do we', 'how can i', 'how can we', 'how should i', 'how should we', 'steps', 'step by step', 'process', 'procedure', 'guide', 'kaise', 'kese', 'kevi rite', 'kai rite', 'kem karvu', 'kem karvanu', 'where do i', 'where can i', 'way to', 'method', 'teach', 'explain'];
const ACTION = ['create', 'make', 'add', 'new', 'enter', 'record', 'do', 'prepare', 'raise', 'generate', 'issue', 'approve', 'update', 'change', 'reset', 'check', 'fix', 'give', 'send', 'receive', 'pack', 'dispatch', 'trace', 'banavu', 'banavvu', 'banana'];

/** Matched phrases count by their length ("direct invoice" beats "invoice"); strong words count double. */
function scoreGuide(p: Parsed, g: Guide) {
  const weight = (terms: string[]) => terms.filter((t) => has(p, t)).reduce((s, t) => s + t.split(' ').length, 0);
  return weight(g.words) + 2 * weight(g.strong ?? []);
}

/** Best guide for the question, or null. */
export function bestGuide(p: Parsed): Guide | null {
  let best: Guide | null = null;
  let top = 0;
  for (const g of GUIDES) {
    const s = scoreGuide(p, g);
    if (s > top) [best, top] = [g, s];
  }
  return best;
}

export const howtoTopics: Topic[] = [
  {
    id: 'howto',
    area: 'Help',
    label: 'guides',
    permissions: ['assistant.view'],
    examples: ['How to make a direct invoice?', 'How do I create a sales order?', 'How to prepare payroll?'],
    // "how to ..." beats the data topics; an action word with a guide subject ("create invoice") is enough too
    score: (p) => (has(p, ...HOW) ? (bestGuide(p) ? 10 : 6) : has(p, ...ACTION) && bestGuide(p) && p.words.size <= 6 && !p.docs.length && !p.shortDocs.length && !p.period ? 5 : 0),
    async answer(ask) {
      const g = bestGuide(ask.p);
      if (!g) {
        return {
          understood: 'Guides',
          text: 'I have step-by-step guides for the daily work in the ERP. Which one do you need?',
          suggestions: GUIDES.slice(0, 8).map((x) => `How to ${x.title.charAt(0).toLowerCase()}${x.title.slice(1)}?`),
        };
      }
      // guides on the same subject first, else the next ones in the list
      const near = GUIDES.filter((x) => x !== g && x.words.some((w) => g.words.includes(w)));
      const others = [...near, ...GUIDES.filter((x) => x !== g && !near.includes(x))].slice(0, 3);
      return {
        understood: `How to · ${g.title}`,
        text: `Here is how to ${g.title.charAt(0).toLowerCase()}${g.title.slice(1)}:`,
        steps: g.steps,
        ...(g.tip ? { insight: g.tip } : {}),
        links: [g.link],
        suggestions: others.map((x) => `How to ${x.title.charAt(0).toLowerCase()}${x.title.slice(1)}?`),
      };
    },
  },
];
