import PDFDocument from 'pdfkit';
import { END_CONNECTION_LABELS, RC_STATUS_LABELS } from '@bht/shared';
import { issuedByHeat, type RouteCardFull } from './route-cards.service';

// A4 landscape: the stage table needs the width.
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN = 32;
const WIDTH = PAGE_W - MARGIN * 2;
const ACCENT = '#c2410c';
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#d1d5db';

const qty = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const dmy = (d: Date | null | undefined) =>
  d ? `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}` : '-';
const v = (x: { toString(): string } | null | undefined) => (x == null ? '' : qty.format(Number(x.toString())));

/** The paper route card that travels with the parts on the shop floor. Filled-in stages are printed too. */
export function renderRouteCardPdf(rc: RouteCardFull, companyName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: MARGIN, bottom: MARGIN + 16, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: `Route Card ${rc.rcNo}`, Author: companyName },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ---------------------------------------------------------------- header
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(companyName, MARGIN, MARGIN, { width: WIDTH / 2 });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Production route card', { width: WIDTH / 2 });
    doc.font('Helvetica-Bold').fontSize(16).fillColor(ACCENT).text(rc.rcNo, MARGIN, MARGIN, { width: WIDTH, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).fillColor(INK);
    doc.text(`Date: ${dmy(rc.rcDate)}   ·   Status: ${RC_STATUS_LABELS[rc.status]}`, { width: WIDTH, align: 'right' });
    let y = Math.max(doc.y, MARGIN + 34) + 6;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + WIDTH, y).lineWidth(1.5).strokeColor(ACCENT).stroke();
    y += 8;

    // ------------------------------------------------------------ info boxes
    const total = Number(rc.plannedQty) + Number(rc.extraQty);
    const so = rc.salesOrderLine?.salesOrder;
    const heats = issuedByHeat(rc.materialIssues).filter((h) => h.quantity > 0);
    const boxes: [string, string][] = [
      [
        'PART',
        [
          rc.item.name,
          `${rc.item.code}${rc.item.drawingNo ? `  ·  Drg ${rc.item.drawingNo}` : ''}`,
          rc.item.endConnection !== 'NONE' ? `End: ${END_CONNECTION_LABELS[rc.item.endConnection]}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      ],
      [
        'FOR',
        so
          ? [`${so.soNo}  ·  ${so.customer.name}`, so.customerPoNo ? `Customer PO ${so.customerPoNo}` : null, rc.salesOrderLine?.service === 'SOUR' ? 'Sour service (NACE)' : null]
              .filter(Boolean)
              .join('\n')
          : `Make to stock${rc.productionRequest ? `\n${rc.productionRequest.requestNo}` : ''}`,
      ],
      [
        'QUANTITY',
        `${v(rc.plannedQty)} pcs + ${v(rc.extraQty)} extra = ${qty.format(total)} pcs\nDelivery: ${dmy(rc.expectedDelivery)}`,
      ],
      [
        'MATERIAL',
        [
          rc.rawMaterial ? `${rc.rawMaterial.grade.name} ${rc.rawMaterial.size}` : '-',
          rc.inputWeightKg ? `${v(rc.inputWeightKg)} kg / pc` : null,
          heats.length ? `Heat: ${heats.map((h) => `${h.heatNo} (${qty.format(h.quantity)} kg)`).join(', ')}` : 'Heat: not issued yet',
        ]
          .filter(Boolean)
          .join('\n'),
      ],
    ];
    const boxW = (WIDTH - 3 * 8) / 4;
    doc.font('Helvetica').fontSize(8.5);
    const boxH = Math.max(...boxes.map(([, t]) => doc.heightOfString(t, { width: boxW - 14 }))) + 26;
    boxes.forEach(([title, text], i) => {
      const x = MARGIN + i * (boxW + 8);
      doc.roundedRect(x, y, boxW, boxH, 4).lineWidth(0.75).strokeColor(LINE).stroke();
      doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED).text(title, x + 7, y + 7, { characterSpacing: 0.5 });
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(text, x + 7, y + 18, { width: boxW - 14, lineGap: 1 });
    });
    y += boxH + 10;
    if (rc.remarks) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text('Notes: ', MARGIN, y, { continued: true });
      doc.font('Helvetica').text(rc.remarks, { width: WIDTH });
      y = doc.y + 8;
    }

    // ------------------------------------------------------------ stage table
    const cols = [
      { h: '#', w: 20, a: 'center' as const },
      { h: 'Stage', w: 128 },
      { h: 'Department', w: 92 },
      { h: 'Received', w: 52, a: 'right' as const },
      { h: 'OK', w: 44, a: 'right' as const },
      { h: 'Rejected', w: 52, a: 'right' as const },
      { h: 'Result / reason / readings', w: 168 },
      { h: 'Wt / pc (kg)', w: 58, a: 'right' as const },
      { h: 'Done by / date', w: 120 },
      { h: 'Sign', w: 0 },
    ];
    cols[cols.length - 1].w = WIDTH - cols.reduce((s, c) => s + c.w, 0);
    const drawHead = () => {
      doc.rect(MARGIN, y, WIDTH, 18).fill('#f3f4f6');
      let x = MARGIN;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
      for (const c of cols) {
        doc.text(c.h.toUpperCase(), x + 4, y + 6, { width: c.w - 8, align: c.a ?? 'left', lineBreak: false });
        x += c.w;
      }
      y += 18;
    };
    drawHead();
    const bottom = PAGE_H - MARGIN - 20;
    rc.operations.forEach((op, i) => {
      const material = op.stage.isMaterialCheck;
      const result = (op.readings as { result?: string } | null)?.result;
      const outcome = material ? (result ? (result === 'OK' ? 'OK' : `Not OK: ${op.rejectionReason ?? ''}`) : '') : (op.rejectionReason ?? '');
      const cells = [
        String(i + 1),
        op.stage.name,
        op.stage.roles.map((r) => r.role.name).join(' / '),
        material ? '' : v(op.receivedQty),
        material ? '' : v(op.okQty),
        material ? '' : v(op.rejectedQty),
        [outcome, op.remarks].filter(Boolean).join(' · '),
        op.stage.captureWeights ? v(op.outputWeightKg) : '',
        op.completedAt ? [op.updatedBy?.name, dmy(op.completedAt)].filter(Boolean).join('\n') : '',
        '',
      ];
      doc.font('Helvetica').fontSize(8.5);
      const h = Math.max(22, ...cells.map((t, ci) => doc.heightOfString(t, { width: cols[ci].w - 8 }) + 10));
      if (y + h > bottom) {
        doc.addPage();
        y = MARGIN;
        drawHead();
      }
      let x = MARGIN;
      cells.forEach((t, ci) => {
        doc.font(ci === 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(INK);
        doc.text(t, x + 4, y + 6, { width: cols[ci].w - 8, align: cols[ci].a ?? 'left' });
        x += cols[ci].w;
      });
      doc.moveTo(MARGIN, y + h).lineTo(MARGIN + WIDTH, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
      y += h;
    });

    // ------------------------------------------------------------ footer
    const range = doc.bufferedPageRange();
    for (let p = range.start; p < range.start + range.count; p++) {
      doc.switchToPage(p);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
      doc.text(`${rc.rcNo}  ·  ${rc.item.name}  ·  Printed ${dmy(new Date())}`, MARGIN, PAGE_H - MARGIN - 2, { width: WIDTH / 2, lineBreak: false });
      doc.text(`Page ${p - range.start + 1} of ${range.count}`, MARGIN + WIDTH / 2, PAGE_H - MARGIN - 2, { width: WIDTH / 2, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
  });
}
