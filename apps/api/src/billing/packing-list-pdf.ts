import PDFDocument from 'pdfkit';
import { END_CONNECTION_LABELS, INDIAN_STATES } from '@bht/shared';
import type { DispatchFull } from './dispatches.service';
import { brand } from '../config/brand';

const MARGIN = 40;
const WIDTH = 595.28 - MARGIN * 2;
const ACCENT = '#c2410c';
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#d1d5db';

const qty = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const dmy = (d: Date | null | undefined) =>
  d ? `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}` : '-';
const stateName = (code: string | null) => INDIAN_STATES.find((s) => s.code === code)?.name;

/** Packing list: sets per product and, for every part, the heat numbers (traceability for the customer). */
export function renderPackingListPdf(d: DispatchFull): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: MARGIN, bottom: MARGIN + 18, left: MARGIN, right: MARGIN }, bufferPages: true, info: { Title: `Packing list ${d.dispatchNo}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const company = d.invoice?.company;
    const bottom = 841.89 - MARGIN - 26;

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(company?.legalName || company?.name || brand().name, MARGIN, MARGIN, { width: WIDTH * 0.6 });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    doc.text(
      [
        [company?.address, company?.city, stateName(company?.stateCode ?? null), company?.pincode].filter(Boolean).join(', '),
        [company?.phone && `Phone: ${company.phone}`, company?.email && `Email: ${company.email}`].filter(Boolean).join('   '),
        company?.gstin && `GSTIN: ${company.gstin}`,
      ]
        .filter(Boolean)
        .join('\n'),
      { width: WIDTH * 0.6, lineGap: 1.5 },
    );
    const hb = doc.y;
    doc.font('Helvetica-Bold').fontSize(14).fillColor(ACCENT).text('PACKING LIST', MARGIN, MARGIN, { width: WIDTH, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    doc.text(`Dispatch: ${d.dispatchNo}`, { width: WIDTH, align: 'right' });
    doc.text(`Date: ${dmy(d.dispatchDate)}`, { width: WIDTH, align: 'right' });
    if (d.cancelledAt) doc.font('Helvetica-Bold').fillColor(ACCENT).text('CANCELLED', { width: WIDTH, align: 'right' });
    let y = Math.max(hb, doc.y) + 8;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + WIDTH, y).lineWidth(1.5).strokeColor(ACCENT).stroke();
    y += 10;

    const colW = (WIDTH - 10) / 2;
    const consignee = [d.invoice?.shippingName || d.invoice?.billingName || d.salesOrder.customer.name, d.invoice?.shippingAddress || d.invoice?.billingAddress].filter(Boolean).join('\n');
    const ref = [
      `Invoice: ${d.invoice?.invoiceNo ?? '-'} (${dmy(d.invoice?.invoiceDate)})`,
      `Our order: ${d.salesOrder.soNo}`,
      d.salesOrder.customerPoNo ? `Customer PO: ${d.salesOrder.customerPoNo}${d.salesOrder.customerPoDate ? ` (${dmy(d.salesOrder.customerPoDate)})` : ''}` : null,
      [d.transporter && `Transporter: ${d.transporter}`, d.lrNo && `LR: ${d.lrNo}`].filter(Boolean).join('  ·  ') || null,
      [d.vehicleNo && `Vehicle: ${d.vehicleNo}`, d.driverName && `Driver: ${d.driverName}${d.driverPhone ? ` (${d.driverPhone})` : ''}`].filter(Boolean).join('  ·  ') || null,
    ]
      .filter(Boolean)
      .join('\n');
    doc.font('Helvetica').fontSize(8.5);
    const boxH = Math.max(doc.heightOfString(consignee, { width: colW - 14 }), doc.heightOfString(ref, { width: colW - 14 })) + 26;
    [
      ['CONSIGNEE', consignee],
      ['REFERENCE & TRANSPORT', ref],
    ].forEach(([t, text], i) => {
      const x = MARGIN + i * (colW + 10);
      doc.roundedRect(x, y, colW, boxH, 4).lineWidth(0.75).strokeColor(LINE).stroke();
      doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED).text(t, x + 7, y + 7, { characterSpacing: 0.5 });
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(text, x + 7, y + 17, { width: colW - 14, lineGap: 1.2 });
    });
    y += boxH + 14;

    // One block per product: sets, then its parts with heats.
    const consumptions = d.invoice?.assembly?.consumptions ?? [];
    for (const line of d.lines) {
      const p = line.salesOrderLine.product;
      const title = `${p.name}${line.salesOrderLine.endConnection !== 'NONE' ? ` · ${END_CONNECTION_LABELS[line.salesOrderLine.endConnection]}` : ''}`;
      const parts = consumptions.filter((c) => c.item.productId === p.id).sort((a, b) => a.item.partType.sortOrder - b.item.partType.sortOrder);
      const needed = 34 + parts.length * 18;
      if (y + needed > bottom) {
        doc.addPage();
        y = MARGIN;
      }
      doc.rect(MARGIN, y, WIDTH, 22).fill('#f3f4f6');
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(title, MARGIN + 6, y + 6, { width: WIDTH - 120 });
      doc.text(`${qty.format(Number(line.quantity))} set(s)`, MARGIN + WIDTH - 110, y + 6, { width: 104, align: 'right' });
      y += 26;
      for (const c of parts) {
        doc.font('Helvetica').fontSize(8.5).fillColor(INK);
        doc.text(c.item.partType.name, MARGIN + 12, y, { width: 90 });
        doc.text(`${c.item.code} · ${c.item.name}`, MARGIN + 100, y, { width: 220, lineBreak: false, ellipsis: true });
        doc.text(c.heat ? `Heat ${c.heat.heatNo}${c.heat.millHeatNo ? ` (mill ${c.heat.millHeatNo})` : ''}` : 'Heat -', MARGIN + 325, y, { width: 140 });
        doc.text(`${qty.format(Number(c.quantity))} pcs`, MARGIN + WIDTH - 70, y, { width: 64, align: 'right' });
        y += 16;
      }
      doc.moveTo(MARGIN, y + 2).lineTo(MARGIN + WIDTH, y + 2).lineWidth(0.5).strokeColor(LINE).stroke();
      y += 10;
    }

    y += 6;
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    doc.text(
      [
        d.invoice?.assembly?.packingType && `Packing: ${d.invoice.assembly.packingType}`,
        d.packages != null && `Packages: ${d.packages}`,
        d.grossWeightKg != null && `Gross weight: ${qty.format(Number(d.grossWeightKg))} kg`,
        d.loadedBy && `Loaded by: ${d.loadedBy}`,
      ]
        .filter(Boolean)
        .join('    ') || '',
      MARGIN,
      y,
      { width: WIDTH },
    );
    y = doc.y + 40;
    doc.moveTo(MARGIN + WIDTH - 170, y).lineTo(MARGIN + WIDTH, y).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(`For ${company?.legalName || company?.name || brand().name}`, MARGIN + WIDTH - 230, y + 4, { width: 230, align: 'right' });

    const range = doc.bufferedPageRange();
    for (let pg = range.start; pg < range.start + range.count; pg++) {
      doc.switchToPage(pg);
      const bm = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
      doc.text(`${d.dispatchNo}  ·  ${d.salesOrder.customer.name}`, MARGIN, 841.89 - MARGIN - 4, { width: WIDTH / 2, lineBreak: false });
      doc.text(`Page ${pg - range.start + 1} of ${range.count}`, MARGIN + WIDTH / 2, 841.89 - MARGIN - 4, { width: WIDTH / 2, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bm;
    }
    doc.end();
  });
}
