import PDFDocument from 'pdfkit';
import { INDIAN_STATES, STOCK_LOCATION_LABELS, STOCK_REF_TYPE_LABELS } from '@bht/shared';
import type { Company } from '../generated/prisma/client';
import type { TraceabilityService } from './traceability.service';
import { brand } from '../config/brand';

type HeatTrace = Awaited<ReturnType<TraceabilityService['heat']>>;
type OrderTrace = Awaited<ReturnType<TraceabilityService['order']>>;

const MARGIN = 40;
const WIDTH = 595.28 - MARGIN * 2;
const BOTTOM = 841.89 - MARGIN - 30;
const ACCENT = '#c2410c';
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#d1d5db';

const qty = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const dmy = (d: Date | string | null | undefined) => {
  if (!d) return '-';
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${String(x.getUTCDate()).padStart(2, '0')}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${x.getUTCFullYear()}`;
};
/** Today in India as dd-mm-yyyy. */
const printed = () => dmy(new Date(Date.now() + 330 * 60_000));
const stateName = (code: string | null) => INDIAN_STATES.find((s) => s.code === code)?.name;

interface Col {
  h: string;
  w: number;
  a?: 'left' | 'right' | 'center';
}

/** A4 page with the company header, tables that continue on the next page, and page numbers. */
class TracePdf {
  readonly doc = new PDFDocument({ size: 'A4', margins: { top: MARGIN, bottom: MARGIN + 20, left: MARGIN, right: MARGIN }, bufferPages: true });
  y = MARGIN;
  private readonly chunks: Buffer[] = [];
  private readonly done: Promise<Buffer>;

  constructor(title: string, company: Company | null) {
    this.doc.info.Title = title;
    this.doc.info.Author = company?.name ?? brand().name;
    this.done = new Promise((resolve, reject) => {
      this.doc.on('data', (c: Buffer) => this.chunks.push(c));
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.on('error', reject);
    });
  }

  header(company: Company | null, title: string, lines: string[]) {
    const { doc } = this;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(company?.legalName || company?.name || brand().name, MARGIN, MARGIN, { width: WIDTH * 0.6 });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    if (company) {
      doc.text(
        [
          [company.address, company.city, stateName(company.stateCode), company.pincode].filter(Boolean).join(', '),
          [company.gstin && `GSTIN: ${company.gstin}`, company.phone && `Phone: ${company.phone}`].filter(Boolean).join('   '),
        ]
          .filter(Boolean)
          .join('\n'),
        { width: WIDTH * 0.6, lineGap: 1.5 },
      );
    }
    const headerBottom = doc.y;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(ACCENT).text(title, MARGIN, MARGIN, { width: WIDTH, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    for (const l of lines) if (l) doc.text(l, { width: WIDTH, align: 'right' });
    this.y = Math.max(headerBottom, doc.y) + 10;
    doc.moveTo(MARGIN, this.y).lineTo(MARGIN + WIDTH, this.y).lineWidth(1.5).strokeColor(ACCENT).stroke();
    this.y += 10;
  }

  /** Two framed boxes side by side. */
  boxes(left: [string, string], right: [string, string]) {
    const { doc } = this;
    const colW = (WIDTH - 12) / 2;
    doc.font('Helvetica').fontSize(8.5);
    const h = Math.max(doc.heightOfString(left[1], { width: colW - 16, lineGap: 1.5 }), doc.heightOfString(right[1], { width: colW - 16, lineGap: 1.5 })) + 30;
    for (const [i, [title, text]] of [left, right].entries()) {
      const x = MARGIN + i * (colW + 12);
      doc.roundedRect(x, this.y, colW, h, 4).lineWidth(0.75).strokeColor(LINE).stroke();
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text(title, x + 8, this.y + 8, { characterSpacing: 0.5 });
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(text, x + 8, this.y + 20, { width: colW - 16, lineGap: 1.5 });
    }
    this.y += h + 14;
  }

  table(title: string, cols: Col[], rows: string[][], empty = 'None.') {
    const { doc } = this;
    if (this.y + 60 > BOTTOM) this.newPage();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(title, MARGIN, this.y, { characterSpacing: 0.5 });
    this.y += 13;
    if (!rows.length) {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(empty, MARGIN, this.y);
      this.y += 22;
      return;
    }
    const head = () => {
      doc.rect(MARGIN, this.y, WIDTH, 17).fill('#f3f4f6');
      let x = MARGIN;
      doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED);
      for (const c of cols) {
        doc.text(c.h.toUpperCase(), x + 4, this.y + 5, { width: c.w - 8, align: c.a ?? 'left', lineBreak: false });
        x += c.w;
      }
      this.y += 17;
    };
    head();
    for (const r of rows) {
      doc.font('Helvetica').fontSize(8);
      const h = Math.max(18, ...r.map((t, i) => doc.heightOfString(t, { width: cols[i].w - 8 }) + 8));
      if (this.y + h > BOTTOM) {
        this.newPage();
        head();
        doc.font('Helvetica').fontSize(8); // the header switched to bold
      }
      let x = MARGIN;
      r.forEach((t, i) => {
        doc.fillColor(INK).text(t, x + 4, this.y + 4, { width: cols[i].w - 8, align: cols[i].a ?? 'left' });
        x += cols[i].w;
      });
      doc.moveTo(MARGIN, this.y + h).lineTo(MARGIN + WIDTH, this.y + h).lineWidth(0.5).strokeColor(LINE).stroke();
      this.y += h;
    }
    this.y += 14;
  }

  note(text: string) {
    if (this.y + 30 > BOTTOM) this.newPage();
    this.doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(text, MARGIN, this.y, { width: WIDTH, lineGap: 2 });
    this.y = this.doc.y + 10;
  }

  /** "For <company>", room to sign, and the signer's role under the line. */
  signature(company: Company | null, label: string) {
    if (this.y + 80 > BOTTOM) this.newPage();
    const top = this.y + 6;
    this.doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(`For ${company?.legalName || company?.name || brand().name}`, MARGIN + WIDTH - 260, top, { width: 260, align: 'right' });
    this.doc.moveTo(MARGIN + WIDTH - 200, top + 46).lineTo(MARGIN + WIDTH, top + 46).lineWidth(0.5).strokeColor(LINE).stroke();
    this.doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(label, MARGIN + WIDTH - 200, top + 50, { width: 200, align: 'right' });
    this.y = top + 66;
  }

  private newPage() {
    this.doc.addPage();
    this.y = MARGIN;
  }

  finish(footer: string): Promise<Buffer> {
    const { doc } = this;
    const range = doc.bufferedPageRange();
    for (let p = range.start; p < range.start + range.count; p++) {
      doc.switchToPage(p);
      const bm = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
      doc.text(`${footer}  ·  Printed ${printed()}`, MARGIN, 841.89 - MARGIN - 4, { width: WIDTH * 0.7, lineBreak: false });
      doc.text(`Page ${p - range.start + 1} of ${range.count}`, MARGIN + WIDTH * 0.7, 841.89 - MARGIN - 4, { width: WIDTH * 0.3, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bm;
    }
    doc.end();
    return this.done;
  }
}

/** Internal QA report: everything that happened to one bar heat. */
export function renderHeatTracePdf(t: HeatTrace, company: Company | null): Promise<Buffer> {
  const pdf = new TracePdf(`Heat traceability ${t.heat.heatNo}`, company);
  const h = t.heat;
  const s = t.summary;
  pdf.header(company, 'HEAT TRACEABILITY', [`Heat: ${h.heatNo}`, h.millHeatNo ? `Mill heat: ${h.millHeatNo}` : '']);
  pdf.boxes(
    ['MATERIAL', [`${h.material.grade} ${h.material.size} (${h.material.code})`, `Mill heat: ${h.millHeatNo ?? '-'}`, `Supplier: ${h.supplier ?? '-'}`, `Received: ${dmy(h.receivedDate)}`, h.remarks].filter(Boolean).join('\n')],
    [
      'WHERE IT WENT',
      [
        `Received ${qty.format(s.receivedKg)} kg · to production ${qty.format(s.toProductionKg)} kg · job work ${qty.format(s.toJobWorkKg)} kg · in store ${qty.format(s.inStoreKg)} kg`,
        `Parts made ${qty.format(s.partsMade)} · packed ${qty.format(s.partsPacked)} · in FG store ${qty.format(s.partsInStore)}`,
        `Customers: ${s.customers.join(', ') || '-'}`,
      ].join('\n'),
    ],
  );
  pdf.table(
    'RECEIVED (GATE ENTRY AND INCOMING QC)',
    [
      { h: 'Gate entry', w: 95 },
      { h: 'Purchase order', w: 85 },
      { h: 'Supplier invoice', w: 95 },
      { h: 'Received kg', w: 62, a: 'right' },
      { h: 'Accepted', w: 58, a: 'right' },
      { h: 'Rejected', w: 55, a: 'right' },
      { h: 'QC', w: WIDTH - 450 },
    ],
    t.receipts.map((r) => [`${r.grnNo}\n${dmy(r.grnDate)}`, r.po?.poNo ?? '-', r.supplierInvoice ?? '-', qty.format(r.receivedQty), qty.format(r.acceptedQty), qty.format(r.rejectedQty), [r.qcStatus, r.qcRemarks].filter(Boolean).join(' · ')]),
    'Opening stock (no gate entry).',
  );
  pdf.table(
    'ROUTE CARDS (BAR ISSUED FROM THIS HEAT)',
    [
      { h: 'Route card', w: 75 },
      { h: 'Part', w: 140 },
      { h: 'Kg', w: 40, a: 'right' },
      { h: 'Planned', w: 48, a: 'right' },
      { h: 'OK', w: 35, a: 'right' },
      { h: 'Rejected', w: 47, a: 'right' },
      { h: 'For', w: WIDTH - 385 },
    ],
    t.routeCards.map((rc) => [
      `${rc.rcNo}\n${dmy(rc.rcDate)}`,
      `${rc.item.name}\n${rc.item.code}`,
      qty.format(rc.kg),
      `${qty.format(rc.plannedQty)}${rc.extraQty ? ` + ${qty.format(rc.extraQty)}` : ''}`,
      qty.format(rc.completedQty),
      qty.format(rc.rejectedQty),
      rc.order ? `${rc.order.soNo}\n${rc.order.customer.name}` : 'Stock',
    ]),
  );
  if (t.jobWork.length) {
    pdf.table(
      'JOB WORK (BAR SENT TO VENDORS)',
      [
        { h: 'Job work order', w: 95 },
        { h: 'Vendor', w: 140 },
        { h: 'Kg sent', w: 55, a: 'right' },
        { h: 'Parts back (accepted / rejected)', w: WIDTH - 290 },
      ],
      t.jobWork.map((j) => [`${j.jwoNo}\n${dmy(j.jwoDate)}`, j.supplier, qty.format(j.kg), j.received.map((r) => `${r.item.name}: ${qty.format(r.acceptedQty)} / ${qty.format(r.rejectedQty)} (${r.receiptNo})`).join('\n') || '-']),
    );
  }
  pdf.table(
    'FINISHED PARTS OF THIS HEAT',
    [
      { h: 'Part', w: 170 },
      { h: 'Made on', w: WIDTH - 170 - 165 },
      { h: 'Made', w: 55, a: 'right' },
      { h: 'Packed', w: 55, a: 'right' },
      { h: 'In store', w: 55, a: 'right' },
    ],
    t.parts.map((p) => [`${p.item.name}\n${p.item.code}`, p.madeOn.join(', ') || '-', qty.format(p.made), qty.format(p.packed), qty.format(p.inStore)]),
  );
  pdf.table(
    'DELIVERED TO',
    [
      { h: 'Customer', w: 105 },
      { h: 'Order', w: 95 },
      { h: 'Packing', w: 70 },
      { h: 'Parts', w: WIDTH - 105 - 95 - 70 - 95 },
      { h: 'Invoice · dispatch', w: 95 },
    ],
    t.deliveries.map((d) => [
      d.customer.name,
      `${d.order.soNo}${d.order.customerPoNo ? `\nPO ${d.order.customerPoNo}` : ''}`,
      `${d.assembly.assemblyNo}\n${dmy(d.assembly.assemblyDate)}`,
      d.parts.map((p) => `${qty.format(p.quantity)} × ${p.item.name}`).join('\n'),
      [...d.invoices.map((i) => i.invoiceNo), ...d.dispatches.map((x) => `${x.dispatchNo}\n${dmy(x.dispatchDate)}`)].join('\n') || 'Not invoiced yet',
    ]),
    'No parts of this heat have been packed yet.',
  );
  if (t.movements.length) {
    pdf.table(
      'RAW MATERIAL MOVEMENTS',
      [
        { h: 'Date', w: 65 },
        { h: 'Movement', w: 110 },
        { h: 'Reference', w: 95 },
        { h: 'Location', w: 85 },
        { h: 'In kg', w: 60, a: 'right' },
        { h: 'Out kg', w: WIDTH - 415, a: 'right' },
      ],
      t.movements.map((m) => [dmy(m.date), STOCK_REF_TYPE_LABELS[m.type], m.refNo ?? '-', STOCK_LOCATION_LABELS[m.location], m.in ? qty.format(m.in) : '', m.out ? qty.format(m.out) : '']),
    );
  }
  if (t.documents.length) pdf.note(`Documents on file: ${t.documents.map((d) => `${d.name} (${d.on})`).join('; ')}`);
  return pdf.finish(`Heat ${h.heatNo}`);
}

/** For the customer: every part of an order with its heat, mill heat and the tests passed. Supplier and vendor names are left out. */
export function renderOrderTracePdf(t: OrderTrace, company: Company | null): Promise<Buffer> {
  const pdf = new TracePdf(`Material traceability ${t.order.soNo}`, company);
  const o = t.order;
  pdf.header(company, 'MATERIAL TRACEABILITY', [`Our order: ${o.soNo}`, o.customerPoNo ? `Your PO: ${o.customerPoNo}` : '']);
  const invoices = t.invoices.filter((i) => i.status === 'ISSUED');
  const dispatches = t.dispatches.filter((d) => !d.cancelled);
  pdf.boxes(
    ['CUSTOMER', [o.customer.name, o.customerPoNo ? `PO ${o.customerPoNo}${o.customerPoDate ? ` dated ${dmy(o.customerPoDate)}` : ''}` : null].filter(Boolean).join('\n')],
    [
      'SUPPLY',
      [
        `Order ${o.soNo} dated ${dmy(o.soDate)}`,
        invoices.length ? `Invoice: ${invoices.map((i) => `${i.invoiceNo} (${dmy(i.invoiceDate)})`).join(', ')}` : null,
        dispatches.length ? `Dispatch: ${dispatches.map((d) => `${d.dispatchNo} (${dmy(d.dispatchDate)})`).join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    ],
  );
  pdf.table(
    'PRODUCTS',
    [
      { h: 'Product', w: 185 },
      { h: 'Specification', w: WIDTH - 185 - 185 },
      { h: 'Ordered', w: 55, a: 'right' },
      { h: 'Packed', w: 55, a: 'right' },
      { h: 'Dispatched', w: 75, a: 'right' },
    ],
    t.lines.map((l) => [l.product, l.spec || '-', qty.format(l.quantity), qty.format(l.packed), qty.format(l.dispatched)]),
  );
  pdf.table(
    'PARTS AND HEAT NUMBERS',
    [
      { h: 'Part', w: 165 },
      { h: 'Qty', w: 40, a: 'right' },
      { h: 'Heat no.', w: 75 },
      { h: 'Mill heat no.', w: 80 },
      { h: 'Material', w: WIDTH - 165 - 40 - 75 - 80 - 85 },
      { h: 'Packing', w: 85 },
    ],
    t.packing
      .filter((p) => p.status !== 'CANCELLED')
      .flatMap((p) =>
        p.parts.map((part) => {
          const heat = t.heats.find((h) => h.heatNo === part.heatNo);
          return [`${part.item.name}\n${part.item.code}`, qty.format(part.quantity), part.heatNo ?? '-', part.millHeatNo ?? '-', heat ? `${heat.grade} ${heat.size}` : '-', p.assemblyNo];
        }),
      ),
    'Nothing packed yet.',
  );
  const tests = (rc: OrderTrace['routeCards'][number]) =>
    rc.stages
      .filter((s) => s.status === 'DONE' && (s.type === 'TEST' || s.type === 'INSPECTION'))
      .map((s) => `${s.name}: ${s.remarks || 'OK'}`)
      .join('\n');
  pdf.table(
    'PRODUCTION AND TESTS',
    [
      { h: 'Route card', w: 80 },
      { h: 'Part · heat', w: 150 },
      { h: 'OK', w: 35, a: 'right' },
      { h: 'Tests and inspections passed', w: WIDTH - 265 },
    ],
    [
      ...t.routeCards.filter((rc) => rc.status !== 'CANCELLED').map((rc) => [rc.rcNo, `${rc.item.name}\nHeat ${rc.heats.map((h) => h.heatNo).join(', ') || '-'}`, qty.format(rc.completedQty), tests(rc) || '-']),
      ...t.jobWork
        .filter((j) => j.status !== 'CANCELLED')
        .map((j) => [
          j.jwoNo,
          `Job work\nHeat ${j.materials.map((m) => m.heatNo).join(', ') || '-'}`,
          qty.format(j.received.reduce((s, r) => s + r.acceptedQty, 0)),
          'Machined outside; every part inspected in-house on receipt (accepted parts only).',
        ]),
    ],
    'No route cards for this order (parts supplied from stock).',
  );
  pdf.note(`Every part carries its heat number. Mill test certificates (EN 10204 3.1) of the heats above are available on request.`);
  pdf.signature(company, 'Quality assurance');
  return pdf.finish(`${o.soNo}  ·  ${o.customer.name}`);
}
