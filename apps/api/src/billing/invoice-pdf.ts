import PDFDocument from 'pdfkit';
import { amountInWords, INDIAN_STATES } from '@bht/shared';
import type { InvoiceFull } from './invoices.service';

const MARGIN = 36;
const WIDTH = 595.28 - MARGIN * 2;
const ACCENT = '#c2410c';
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#d1d5db';

const money = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const dmy = (d: Date | null | undefined) =>
  d ? `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}` : '-';
const stateName = (code: string | null) => INDIAN_STATES.find((s) => s.code === code)?.name;
const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));

const TITLE: Record<string, string> = { TAX_INVOICE: 'TAX INVOICE', EXPORT_INVOICE: 'EXPORT INVOICE', PROFORMA: 'PROFORMA INVOICE' };

const UNIT_NAMES: Record<string, string> = { SET: 'Set', NOS: 'Nos', PCS: 'Pcs', KG: 'Kg', MTR: 'Mtr' };

/** GST tax invoice / export invoice. `heats` = heat numbers of the parts packed (traceability). */
export function renderInvoicePdf(inv: InvoiceFull, heats: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN + 18, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: `Invoice ${inv.invoiceNo}`, Author: inv.company.name },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const c = inv.company;
    const cur = inv.currency === 'INR' ? 'Rs.' : inv.currency;
    const bottom = 841.89 - MARGIN - 26;

    // ---------------------------------------------------------------- header
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(c.legalName || c.name, MARGIN, MARGIN, { width: WIDTH * 0.62 });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    doc.text(
      [
        [c.address, c.city, stateName(c.stateCode), c.pincode].filter(Boolean).join(', '),
        [c.phone && `Phone: ${c.phone}`, c.email && `Email: ${c.email}`].filter(Boolean).join('   '),
        [c.gstin && `GSTIN: ${c.gstin}`, c.pan && `PAN: ${c.pan}`, inv.type === 'EXPORT_INVOICE' && c.iecCode ? `IEC: ${c.iecCode}` : null].filter(Boolean).join('   '),
      ]
        .filter(Boolean)
        .join('\n'),
      { width: WIDTH * 0.62, lineGap: 1.5 },
    );
    const headerBottom = doc.y;
    doc.font('Helvetica-Bold').fontSize(14).fillColor(ACCENT).text(TITLE[inv.type] ?? 'INVOICE', MARGIN, MARGIN, { width: WIDTH, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Original for recipient', { width: WIDTH, align: 'right' });
    if (inv.status !== 'ISSUED') doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text(inv.status, { width: WIDTH, align: 'right' });
    let y = Math.max(headerBottom, doc.y) + 8;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + WIDTH, y).lineWidth(1.5).strokeColor(ACCENT).stroke();
    y += 8;

    // ------------------------------------------------------------ info grid
    const facts: [string, string][] = [
      ['Invoice no.', inv.status === 'DRAFT' ? 'DRAFT' : inv.invoiceNo],
      ['Invoice date', dmy(inv.invoiceDate)],
      ['Due date', dmy(inv.dueDate)],
      ['Customer PO', [inv.customerPoNo, inv.customerPoDate && dmy(inv.customerPoDate)].filter(Boolean).join('\n') || '-'],
      ['Our order', inv.salesOrder?.soNo ?? '-'],
      ['Place of supply', inv.type === 'EXPORT_INVOICE' ? 'Outside India (export)' : inv.placeOfSupply ? `${stateName(inv.placeOfSupply) ?? ''} (${inv.placeOfSupply})` : '-'],
      ['Transporter', inv.transporter ?? '-'],
      ['Vehicle no.', inv.vehicleNo ?? '-'],
    ];
    // 4 facts per row; a long value (e.g. customer PO no. + date) wraps and pushes the next row down
    const fw = WIDTH / 4;
    for (let r = 0; r < facts.length; r += 4) {
      const row = facts.slice(r, r + 4);
      doc.font('Helvetica').fontSize(8.5);
      const rowH = Math.max(...row.map(([, v]) => doc.heightOfString(v, { width: fw - 8 }))) + 9;
      row.forEach(([k, v], i) => {
        const x = MARGIN + i * fw;
        doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED).text(k.toUpperCase(), x, y, { width: fw - 8, characterSpacing: 0.4 });
        doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(v, x, y + 9, { width: fw - 8 });
      });
      y += rowH + 6;
    }
    y += 4;

    // -------------------------------------------------------- bill / ship to
    const colW = (WIDTH - 10) / 2;
    const party = (name: string | null, address: string | null, gstin: string | null) =>
      [name, address, gstin ? `GSTIN: ${gstin}` : null].filter(Boolean).join('\n') || '-';
    const billTo = party(inv.billingName, inv.billingAddress, inv.billingGstin);
    const shipTo = party(inv.shippingName || inv.billingName, inv.shippingAddress || inv.billingAddress, inv.shippingGstin);
    doc.font('Helvetica').fontSize(8.5);
    const boxH = Math.max(doc.heightOfString(billTo, { width: colW - 14 }), doc.heightOfString(shipTo, { width: colW - 14 })) + 26;
    [
      ['BILL TO', billTo],
      ['SHIP TO', shipTo],
    ].forEach(([t, text], i) => {
      const x = MARGIN + i * (colW + 10);
      doc.roundedRect(x, y, colW, boxH, 4).lineWidth(0.75).strokeColor(LINE).stroke();
      doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED).text(t, x + 7, y + 7, { characterSpacing: 0.5 });
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(text, x + 7, y + 17, { width: colW - 14, lineGap: 1.2 });
    });
    y += boxH + 12;

    // ---------------------------------------------------------------- lines
    const cols = [
      { h: '#', w: 22, a: 'center' as const },
      { h: 'Description', w: WIDTH - 22 - 60 - 50 - 40 - 75 - 85 },
      { h: 'HSN', w: 60 },
      { h: 'Qty', w: 50, a: 'right' as const },
      { h: 'Unit', w: 40 },
      { h: `Rate (${cur})`, w: 75, a: 'right' as const },
      { h: `Amount (${cur})`, w: 85, a: 'right' as const },
    ];
    const head = () => {
      doc.rect(MARGIN, y, WIDTH, 18).fill('#f3f4f6');
      let x = MARGIN;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
      for (const col of cols) {
        doc.text(col.h.toUpperCase(), x + 4, y + 6, { width: col.w - 8, align: col.a ?? 'left', lineBreak: false });
        x += col.w;
      }
      y += 18;
    };
    head();
    inv.lines.forEach((l, i) => {
      const cells = [String(i + 1), l.description, l.hsnCode ?? '', qty.format(n(l.quantity)), UNIT_NAMES[l.uom] ?? l.uom, money.format(n(l.rate)), money.format(n(l.amount))];
      doc.font('Helvetica').fontSize(8.5);
      const h = Math.max(20, ...cells.map((t, ci) => doc.heightOfString(t, { width: cols[ci].w - 8 }) + 9));
      if (y + h > bottom - 200) {
        doc.addPage();
        y = MARGIN;
        head();
      }
      let x = MARGIN;
      cells.forEach((t, ci) => {
        doc.fillColor(INK).text(t, x + 4, y + 5, { width: cols[ci].w - 8, align: cols[ci].a ?? 'left' });
        x += cols[ci].w;
      });
      doc.moveTo(MARGIN, y + h).lineTo(MARGIN + WIDTH, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
      y += h;
    });
    y += 10;

    // ---------------------------------------------------------------- totals
    const half = n(inv.taxRate) / 2;
    const rows: [string, string, boolean?][] = [['Sub total', money.format(n(inv.subTotal))]];
    if (n(inv.discountAmount)) rows.push([`Discount (${qty.format(n(inv.discountPercent))}%)`, `- ${money.format(n(inv.discountAmount))}`]);
    if (n(inv.freight)) rows.push(['Freight', money.format(n(inv.freight))]);
    rows.push(['Taxable value', money.format(n(inv.taxableAmount))]);
    if (inv.gstType === 'INTRA_STATE') {
      rows.push([`CGST ${qty.format(half)}%`, money.format(n(inv.cgstAmount))], [`SGST ${qty.format(half)}%`, money.format(n(inv.sgstAmount))]);
    } else if (inv.gstType === 'INTER_STATE') {
      rows.push([`IGST ${qty.format(n(inv.taxRate))}%`, money.format(n(inv.igstAmount))]);
    } else {
      rows.push([inv.gstType === 'EXPORT' ? 'IGST (export under LUT)' : 'GST (exempt)', money.format(0)]);
    }
    if (n(inv.roundOff)) rows.push(['Round off', money.format(n(inv.roundOff))]);
    rows.push([`Grand total (${cur})`, money.format(n(inv.grandTotal)), true]);
    const tx = MARGIN + WIDTH - 230;
    let ty = y;
    for (const [k, v, strong] of rows) {
      if (strong) {
        doc.rect(tx, ty - 2, 230, 20).fill('#fff7ed');
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK);
      } else doc.font('Helvetica').fontSize(8.5).fillColor(INK);
      doc.text(k, tx + 6, ty + (strong ? 3 : 0), { width: 130 });
      doc.text(v, tx + 130, ty + (strong ? 3 : 0), { width: 94, align: 'right' });
      ty += strong ? 22 : 14;
    }
    // Left of totals: amount in words, heats, notes.
    let ly = y;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text('AMOUNT IN WORDS', MARGIN, ly, { characterSpacing: 0.4 });
    doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(amountInWords(n(inv.grandTotal), inv.currency), MARGIN, ly + 10, { width: WIDTH - 250 });
    ly = doc.y + 8;
    if (heats.length) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text('HEAT NUMBERS', MARGIN, ly, { characterSpacing: 0.4 });
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(heats.join(', '), MARGIN, ly + 10, { width: WIDTH - 250 });
      ly = doc.y + 8;
    }
    if (inv.notes) {
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(inv.notes, MARGIN, ly, { width: WIDTH - 250 });
      ly = doc.y + 8;
    }
    y = Math.max(ty, ly) + 10;

    // -------------------------------------------------- bank, terms, signature
    if (y + 120 > bottom) {
      doc.addPage();
      y = MARGIN;
    }
    const bank = [
      c.bankName && `Bank: ${c.bankName}${c.bankBranch ? `, ${c.bankBranch}` : ''}`,
      c.bankAccountNo && `A/c no.: ${c.bankAccountNo}`,
      c.bankIfsc && `IFSC: ${c.bankIfsc}`,
      inv.currency !== 'INR' && c.swiftCode ? `SWIFT: ${c.swiftCode}` : null,
    ]
      .filter(Boolean)
      .join('   ');
    if (bank) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text('BANK DETAILS', MARGIN, y, { characterSpacing: 0.4 });
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(bank, MARGIN, y + 10, { width: WIDTH });
      y = doc.y + 10;
    }
    if (inv.terms) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text('TERMS & CONDITIONS', MARGIN, y, { characterSpacing: 0.4 });
      doc.font('Helvetica').fontSize(8).fillColor(INK).text(inv.terms, MARGIN, y + 10, { width: WIDTH * 0.6, lineGap: 1.5 });
    }
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(`For ${c.legalName || c.name}`, MARGIN + WIDTH - 230, y, { width: 230, align: 'right' });
    doc.moveTo(MARGIN + WIDTH - 170, y + 44).lineTo(MARGIN + WIDTH, y + 44).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Authorised signatory', MARGIN + WIDTH - 230, y + 48, { width: 230, align: 'right' });

    const range = doc.bufferedPageRange();
    for (let p = range.start; p < range.start + range.count; p++) {
      doc.switchToPage(p);
      if (inv.status === 'DRAFT' || inv.status === 'CANCELLED') {
        doc.save();
        doc.rotate(-30, { origin: [297, 420] });
        doc.font('Helvetica-Bold').fontSize(96).fillColor('#e5e7eb').fillOpacity(0.55);
        doc.text(inv.status, 0, 380, { width: 595, align: 'center', lineBreak: false });
        doc.restore();
        doc.fillOpacity(1);
      }
      const bm = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
      doc.text(`${inv.status === 'DRAFT' ? 'Draft' : inv.invoiceNo}  ·  This is a computer generated invoice.`, MARGIN, 841.89 - MARGIN - 4, { width: WIDTH / 2, lineBreak: false });
      doc.text(`Page ${p - range.start + 1} of ${range.count}`, MARGIN + WIDTH / 2, 841.89 - MARGIN - 4, { width: WIDTH / 2, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bm;
    }
    doc.end();
  });
}
