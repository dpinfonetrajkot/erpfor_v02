import PDFDocument from 'pdfkit';
import { amountInWords, computeTotals, INDIAN_STATES, type GstType } from '@bht/shared';
import { poLineLabel, type PurchaseOrderFull } from './po-shape';

const MARGIN = 40;
const WIDTH = 595.28 - MARGIN * 2;
const ACCENT = '#c2410c';
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#d1d5db';

const num = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const dmy = (d: Date | null) =>
  d ? `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}` : '-';
const stateName = (code: string | null) => INDIAN_STATES.find((s) => s.code === code)?.name;

/** Builds the purchase order PDF sent to the supplier. */
export function renderPurchaseOrderPdf(po: PurchaseOrderFull): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN + 20, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: `Purchase Order ${po.poNo}`, Author: po.company.name, Subject: `PO to ${po.supplier.name}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const cur = po.currency === 'INR' ? 'Rs.' : po.currency;
    const money = (v: { toString(): string } | number) => num.format(Number(v.toString()));

    // ---------------------------------------------------------------- header
    const c = po.company;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(15).text(c.name, MARGIN, MARGIN, { width: WIDTH * 0.62 });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    const companyLines = [
      [c.address, c.city, stateName(c.stateCode), c.pincode].filter(Boolean).join(', '),
      [c.phone && `Phone: ${c.phone}`, c.email && `Email: ${c.email}`].filter(Boolean).join('   '),
      [c.gstin && `GSTIN: ${c.gstin}`, c.pan && `PAN: ${c.pan}`].filter(Boolean).join('   '),
    ].filter(Boolean);
    doc.text(companyLines.join('\n'), { width: WIDTH * 0.62, lineGap: 1.5 });
    const headerBottom = doc.y;

    doc.font('Helvetica-Bold').fontSize(14).fillColor(ACCENT).text(po.type === 'JOB_WORK' ? 'JOB WORK PURCHASE ORDER' : 'PURCHASE ORDER', MARGIN, MARGIN, { width: WIDTH, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    doc.text(`PO No.: ${po.poNo}`, { width: WIDTH, align: 'right' });
    doc.text(`Date: ${dmy(po.poDate)}`, { width: WIDTH, align: 'right' });
    if (po.jobWorkOrder) doc.text(`Job work order: ${po.jobWorkOrder.jwoNo}`, { width: WIDTH, align: 'right' });
    if (po.status !== 'ISSUED' && po.status !== 'PARTIALLY_RECEIVED' && po.status !== 'RECEIVED') {
      doc.font('Helvetica-Bold').fillColor(ACCENT).text(po.status.replace('_', ' '), { width: WIDTH, align: 'right' });
    }

    let y = Math.max(headerBottom, doc.y) + 10;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + WIDTH, y).lineWidth(1.5).strokeColor(ACCENT).stroke();
    y += 10;

    // --------------------------------------------------- supplier / delivery
    const colW = (WIDTH - 12) / 2;
    const s = po.supplier;
    const supplierText = [
      [s.address, s.city, stateName(s.stateCode), s.pincode, s.country !== 'India' ? s.country : null].filter(Boolean).join(', '),
      s.gstin ? `GSTIN: ${s.gstin}` : null,
      [s.contactPerson, s.phone, s.email].filter(Boolean).join('  ·  ') || null,
    ]
      .filter(Boolean)
      .join('\n');
    const deliveryText = [
      po.deliveryAddress || [c.name, c.address, c.city].filter(Boolean).join(', '),
      `Expected delivery: ${dmy(po.expectedDelivery)}`,
      `Payment terms: ${po.paymentTerms || '-'}`,
      po.quotationRef ? `Your quotation: ${po.quotationRef}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    // measure with the same font and line gap used to draw, so the text never spills out of the box
    const nameH = doc.font('Helvetica-Bold').fontSize(10).heightOfString(s.name, { width: colW - 16 });
    doc.font('Helvetica').fontSize(8.5);
    const boxH = Math.max(
      nameH + doc.heightOfString(supplierText, { width: colW - 16, lineGap: 1.5 }) + 28,
      doc.heightOfString(deliveryText, { width: colW - 16, lineGap: 1.5 }) + 28,
      70,
    );
    box(doc, MARGIN, y, colW, boxH);
    box(doc, MARGIN + colW + 12, y, colW, boxH);
    label(doc, 'SUPPLIER', MARGIN + 8, y + 7);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(s.name, MARGIN + 8, y + 19, { width: colW - 16 });
    doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(supplierText, { width: colW - 16, lineGap: 1.5 });
    label(doc, 'DELIVER TO', MARGIN + colW + 20, y + 7);
    doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(deliveryText, MARGIN + colW + 20, y + 19, { width: colW - 16, lineGap: 1.5 });
    y += boxH + 14;

    // ----------------------------------------------------------- line table
    const cols = [
      { key: 'no', title: '#', w: 22, align: 'left' as const },
      { key: 'item', title: po.type === 'JOB_WORK' ? 'Part (job work)' : 'Material', w: 243, align: 'left' as const },
      { key: 'qty', title: 'Quantity', w: 70, align: 'right' as const },
      { key: 'uom', title: 'Unit', w: 35, align: 'center' as const },
      { key: 'rate', title: `Rate (${cur})`, w: 70, align: 'right' as const },
      { key: 'amount', title: `Amount (${cur})`, w: WIDTH - 22 - 243 - 70 - 35 - 70, align: 'right' as const },
    ];
    const bottom = 841.89 - MARGIN - 30;

    const drawHead = () => {
      doc.rect(MARGIN, y, WIDTH, 20).fill('#f3f4f6');
      let x = MARGIN;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(INK);
      for (const col of cols) {
        doc.text(col.title, x + 5, y + 6, { width: col.w - 10, align: col.align });
        x += col.w;
      }
      y += 20;
    };
    drawHead();

    po.lines.forEach((line, i) => {
      const { title, code } = poLineLabel(line);
      const sub = [line.description, code && `Code ${code}`, line.purchaseRequisition && `Req. ${line.purchaseRequisition.prNo}`]
        .filter(Boolean)
        .join('  ·  ');
      doc.font('Helvetica-Bold').fontSize(9);
      const h = Math.max(
        doc.heightOfString(title, { width: cols[1].w - 10 }) + doc.font('Helvetica').fontSize(7.5).heightOfString(sub, { width: cols[1].w - 10 }) + 12,
        24,
      );
      if (y + h > bottom) {
        doc.addPage();
        y = MARGIN;
        drawHead();
      }
      const values = [String(i + 1), '', qty.format(Number(line.quantity)), line.uom, money(line.rate), money(line.amount)];
      let x = MARGIN;
      cols.forEach((col, ci) => {
        if (col.key === 'item') {
          doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(title, x + 5, y + 6, { width: col.w - 10 });
          doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(sub, { width: col.w - 10 });
        } else {
          doc.font('Helvetica').fontSize(9).fillColor(INK).text(values[ci], x + 5, y + 6, { width: col.w - 10, align: col.align });
        }
        x += col.w;
      });
      y += h;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + WIDTH, y).lineWidth(0.5).strokeColor(LINE).stroke();
    });

    // --------------------------------------------------------------- totals
    const totals = computeTotals({
      lines: po.lines.map((l) => ({ quantity: Number(l.quantity), rate: Number(l.rate) })),
      discountPercent: Number(po.discountPercent),
      freight: Number(po.freight),
      taxRate: Number(po.taxRate),
      gstType: po.gstType as GstType,
      currency: po.currency,
    });
    const half = Number(po.taxRate) / 2;
    const rows: [string, string, boolean?][] = [['Sub total', money(totals.subTotal)]];
    if (totals.discountAmount) rows.push([`Discount (${Number(po.discountPercent)}%)`, `- ${money(totals.discountAmount)}`]);
    if (Number(po.freight)) rows.push(['Freight / packing', money(po.freight)]);
    rows.push(['Taxable value', money(totals.taxableAmount)]);
    if (po.gstType === 'INTRA_STATE') {
      rows.push([`CGST ${half}%`, money(totals.cgst)], [`SGST ${half}%`, money(totals.sgst)]);
    } else if (po.gstType === 'INTER_STATE') {
      rows.push([`IGST ${Number(po.taxRate)}%`, money(totals.igst)]);
    }
    if (totals.roundOff) rows.push(['Round off', money(totals.roundOff)]);
    rows.push([`Grand total (${cur})`, money(totals.grandTotal), true]);

    const totalsH = rows.length * 16 + 10;
    if (y + totalsH + 60 > bottom) {
      doc.addPage();
      y = MARGIN;
    }
    y += 8;
    const tx = MARGIN + WIDTH - 230;
    let ty = y;
    for (const [k, v, strong] of rows) {
      if (strong) {
        doc.rect(tx, ty - 3, 230, 19).fill('#fff7ed');
        doc.font('Helvetica-Bold').fillColor(ACCENT);
      } else {
        doc.font('Helvetica').fillColor(INK);
      }
      doc.fontSize(9).text(k, tx + 6, ty + 1, { width: 120 });
      doc.text(v, tx + 110, ty + 1, { width: 114, align: 'right' });
      ty += 16;
    }
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('AMOUNT IN WORDS', MARGIN, y, { width: WIDTH - 250 });
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(amountInWords(totals.grandTotal, po.currency), { width: WIDTH - 250 });
    if (po.notes) {
      doc.moveDown(0.6).font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('NOTES', { width: WIDTH - 250 });
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(po.notes, { width: WIDTH - 250 });
    }
    y = Math.max(ty, doc.y) + 16;

    // ------------------------------------------------- terms and signatures
    const terms = po.terms || c.purchaseTerms;
    if (terms) {
      const termsH = doc.font('Helvetica').fontSize(8.5).heightOfString(terms, { width: WIDTH }) + 20;
      if (y + termsH + 80 > bottom) {
        doc.addPage();
        y = MARGIN;
      }
      label(doc, 'TERMS & CONDITIONS', MARGIN, y);
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(terms, MARGIN, y + 12, { width: WIDTH, lineGap: 2 });
      y = doc.y + 18;
    }
    if (y + 70 > bottom) {
      doc.addPage();
      y = MARGIN;
    }
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    doc.text(po.approvedAt ? `Approved on ${dmy(po.approvedAt)}` : 'Not yet approved', MARGIN, y + 48, { width: 200 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(`For ${c.name}`, MARGIN + WIDTH - 220, y, { width: 220, align: 'right' });
    doc.moveTo(MARGIN + WIDTH - 160, y + 44).lineTo(MARGIN + WIDTH, y + 44).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Authorised signatory', MARGIN + WIDTH - 220, y + 48, { width: 220, align: 'right' });

    // --------------------------------------------- watermark + page footer
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      if (po.status === 'DRAFT' || po.status === 'CANCELLED') {
        doc.save();
        doc.rotate(-30, { origin: [297, 420] });
        doc.font('Helvetica-Bold').fontSize(96).fillColor('#e5e7eb').fillOpacity(0.55);
        doc.text(po.status, 0, 380, { width: 595, align: 'center', lineBreak: false });
        doc.restore();
        doc.fillOpacity(1);
      }
      // Writing inside the bottom margin would make pdfkit start a new page.
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
      doc.text(`${po.poNo}  ·  This is a computer generated purchase order.`, MARGIN, 841.89 - MARGIN - 4, {
        width: WIDTH / 2,
        lineBreak: false,
      });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN + WIDTH / 2, 841.89 - MARGIN - 4, {
        width: WIDTH / 2,
        align: 'right',
        lineBreak: false,
      });
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
  });
}

function box(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number) {
  doc.roundedRect(x, y, w, h, 4).lineWidth(0.75).strokeColor(LINE).stroke();
}

function label(doc: PDFKit.PDFDocument, text: string, x: number, y: number) {
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text(text, x, y, { characterSpacing: 0.5 });
}
