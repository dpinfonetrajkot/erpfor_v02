import PDFDocument from 'pdfkit';
import { INDIAN_STATES, JWO_STATUS_LABELS } from '@bht/shared';
import type { Company } from '../generated/prisma/client';
import { issuedByHeat } from '../production/route-cards.service';
import type { JobWorkOrderFull } from './job-work.service';
import { brand } from '../config/brand';

const MARGIN = 40;
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

/** Job work order + delivery challan: what the vendor makes and the material (by heat) sent with it. */
export function renderJobWorkPdf(jwo: JobWorkOrderFull, company: Company | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN + 20, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: `Job Work Order ${jwo.jwoNo}`, Author: company?.name ?? brand().name },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const bottom = 841.89 - MARGIN - 30;

    // ---------------------------------------------------------------- header
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(company?.name ?? brand().name, MARGIN, MARGIN, { width: WIDTH * 0.6 });
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
    doc.font('Helvetica-Bold').fontSize(12).fillColor(ACCENT).text('JOB WORK ORDER', MARGIN, MARGIN, { width: WIDTH, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('& DELIVERY CHALLAN', { width: WIDTH, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    doc.text(`No.: ${jwo.jwoNo}`, { width: WIDTH, align: 'right' });
    doc.text(`Date: ${dmy(jwo.jwoDate)}`, { width: WIDTH, align: 'right' });
    if (jwo.challanNo) doc.text(`Challan: ${jwo.challanNo}`, { width: WIDTH, align: 'right' });
    if (jwo.status === 'CANCELLED') doc.font('Helvetica-Bold').fillColor(ACCENT).text(JWO_STATUS_LABELS[jwo.status].toUpperCase(), { width: WIDTH, align: 'right' });
    let y = Math.max(headerBottom, doc.y) + 10;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + WIDTH, y).lineWidth(1.5).strokeColor(ACCENT).stroke();
    y += 10;

    // ------------------------------------------------------- vendor / order
    const s = jwo.supplier;
    const colW = (WIDTH - 12) / 2;
    const vendorText = [
      s.name,
      [s.address, s.city, stateName(s.stateCode), s.pincode].filter(Boolean).join(', '),
      s.gstin ? `GSTIN: ${s.gstin}` : null,
      [s.contactPerson, s.phone, s.email].filter(Boolean).join('  ·  ') || null,
    ]
      .filter(Boolean)
      .join('\n');
    const orderText = [
      jwo.salesOrder ? `For our order ${jwo.salesOrder.soNo} (${jwo.salesOrder.customer.name})` : 'For our stock',
      `Return parts by: ${dmy(jwo.expectedDate)}`,
      jwo.remarks,
    ]
      .filter(Boolean)
      .join('\n');
    doc.font('Helvetica').fontSize(8.5);
    const boxH = Math.max(doc.heightOfString(vendorText, { width: colW - 16 }), doc.heightOfString(orderText, { width: colW - 16 })) + 30;
    for (const [i, [title, text]] of [
      ['JOB WORKER (VENDOR)', vendorText],
      ['ORDER', orderText],
    ].entries()) {
      const x = MARGIN + i * (colW + 12);
      doc.roundedRect(x, y, colW, boxH, 4).lineWidth(0.75).strokeColor(LINE).stroke();
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text(title, x + 8, y + 8, { characterSpacing: 0.5 });
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(text, x + 8, y + 20, { width: colW - 16, lineGap: 1.5 });
    }
    y += boxH + 14;

    // ------------------------------------------------------------- tables
    const table = (title: string, cols: { h: string; w: number; a?: 'left' | 'right' | 'center' }[], rows: string[][], total?: string[]) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(title, MARGIN, y, { characterSpacing: 0.5 });
      y += 13;
      const head = () => {
        doc.rect(MARGIN, y, WIDTH, 17).fill('#f3f4f6');
        let x = MARGIN;
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
        for (const c of cols) {
          doc.text(c.h.toUpperCase(), x + 4, y + 5, { width: c.w - 8, align: c.a ?? 'left', lineBreak: false });
          x += c.w;
        }
        y += 17;
      };
      head();
      for (const r of [...rows, ...(total ? [total] : [])]) {
        const isTotal = total && r === total;
        doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
        const h = Math.max(20, ...r.map((t, i) => doc.heightOfString(t, { width: cols[i].w - 8 }) + 9));
        if (y + h > bottom) {
          doc.addPage();
          y = MARGIN;
          head();
        }
        let x = MARGIN;
        r.forEach((t, i) => {
          doc.fillColor(INK).text(t, x + 4, y + 5, { width: cols[i].w - 8, align: cols[i].a ?? 'left' });
          x += cols[i].w;
        });
        doc.moveTo(MARGIN, y + h).lineTo(MARGIN + WIDTH, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
        y += h;
      }
      y += 14;
    };

    let charges = 0;
    const partRows = jwo.lines.map((l, i) => {
      const amount = Number(l.quantity) * Number(l.rate);
      charges += amount;
      return [
        String(i + 1),
        `${l.item.name}\n${l.item.code}${l.item.drawingNo ? ` · Drg ${l.item.drawingNo}` : ''}${l.remarks ? `\n${l.remarks}` : ''}`,
        qty.format(Number(l.quantity)),
        Number(l.rate) ? money.format(Number(l.rate)) : '-',
        Number(l.rate) ? money.format(amount) : '-',
      ];
    });
    table(
      'PARTS TO MAKE',
      [
        { h: '#', w: 24, a: 'center' },
        { h: 'Part', w: WIDTH - 24 - 70 - 80 - 90 },
        { h: 'Qty (pcs)', w: 70, a: 'right' },
        { h: 'Rate (Rs.)', w: 80, a: 'right' },
        { h: 'Amount (Rs.)', w: 90, a: 'right' },
      ],
      partRows,
      charges ? ['', 'Job work charges (GST extra)', '', '', money.format(charges)] : undefined,
    );

    const materialRows = jwo.materials.flatMap((m) => {
      const heats = issuedByHeat(m.issues).filter((h) => h.quantity > 0);
      const name = `${m.rawMaterial.grade.name} ${m.rawMaterial.size}`;
      return heats.length
        ? heats.map((h) => [name, h.heatNo, h.millHeatNo ?? '-', qty.format(h.quantity)])
        : [[name, 'not sent yet', '', `(${qty.format(Number(m.quantity))} planned)`]];
    });
    if (materialRows.length) {
      table(
        'OUR MATERIAL SENT FOR JOB WORK (NOT FOR SALE)',
        [
          { h: 'Raw material', w: WIDTH - 110 - 110 - 90 },
          { h: 'Heat no.', w: 110 },
          { h: 'Mill heat no.', w: 110 },
          { h: 'Quantity (kg)', w: 90, a: 'right' },
        ],
        materialRows,
      );
    }

    // ------------------------------------------------------- notes + signs
    if (y + 110 > bottom) {
      doc.addPage();
      y = MARGIN;
    }
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
      [
        'Goods sent for job work under section 143 of the CGST Act; they remain our property.',
        'Keep our heat number on every part and return the parts with your challan quoting this number.',
        'Parts rejected at our inspection are to be reworked or replaced free of cost.',
      ].join('\n'),
      MARGIN,
      y,
      { width: WIDTH, lineGap: 2 },
    );
    y = doc.y + 34;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + 180, y).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.moveTo(MARGIN + WIDTH - 180, y).lineTo(MARGIN + WIDTH, y).stroke();
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    doc.text('Received by (vendor) · date', MARGIN, y + 4, { width: 180 });
    doc.text(`For ${company?.name ?? brand().name}`, MARGIN + WIDTH - 180, y + 4, { width: 180, align: 'right' });

    const range = doc.bufferedPageRange();
    for (let p = range.start; p < range.start + range.count; p++) {
      doc.switchToPage(p);
      const bm = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
      doc.text(`${jwo.jwoNo}  ·  ${jwo.supplier.name}`, MARGIN, 841.89 - MARGIN - 4, { width: WIDTH / 2, lineBreak: false });
      doc.text(`Page ${p - range.start + 1} of ${range.count}`, MARGIN + WIDTH / 2, 841.89 - MARGIN - 4, { width: WIDTH / 2, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bm;
    }
    doc.end();
  });
}
