/**
 * Just enough of the Excel (.xlsx) format to give out import templates and to read filled-in files,
 * using only Node's own zlib (no outside package). Reads files saved by Excel, LibreOffice, Google Sheets
 * and WPS, and CSV files. An .xlsx file is a zip of XML parts: the workbook (sheet names), one part per
 * sheet (the cells), and a shared list of the texts the cells point to.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';

/** A cell as typed: text, number, Yes/No, or empty. */
export type Cell = string | number | boolean | null;

export interface Sheet {
  name: string;
  /** rows[r][c], from row 1 / column A; missing cells are null. */
  rows: Cell[][];
  /** Dates in this workbook count from 1904 (old Mac Excel) instead of 1900. */
  date1904: boolean;
}

/** A problem with the file itself (not with the data in it); the message is shown to the user. */
export class FileProblem extends Error {}

const NOT_EXCEL = 'This is not an Excel (.xlsx) or CSV file. In Excel use File → Save As → "Excel Workbook (.xlsx)".';
const BROKEN = 'The file looks damaged and cannot be read. Open it in Excel, save it again as .xlsx and upload that copy.';
const OLD_OR_LOCKED =
  'This is an old Excel 97-2003 (.xls) file or a password-protected file. Open it in Excel and use File → Save As → "Excel Workbook (.xlsx)" without a password.';

/** Biggest unpacked part we accept; a normal 5,000-row sheet is a few MB. */
const MAX_PART_BYTES = 80 * 1024 * 1024;

// ======================================================================= zip

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip file from its parts (deflated, UTF-8 names). */
export function zip(files: { name: string; data: string | Buffer }[]): Buffer {
  const out: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data;
    const packed = deflateRawSync(raw);
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time 00:00
    local.writeUInt16LE(0x21, 12); // date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // made by
    entry.writeUInt16LE(20, 6); // needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    // extra, comment, disk, attributes: 0
    entry.writeUInt32LE(offset, 42);

    out.push(local, name, packed);
    central.push(entry, name);
    offset += local.length + name.length + packed.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...out, ...central, end]);
}

interface ZipEntry {
  flags: number;
  method: number;
  packedSize: number;
  offset: number;
}

/** The parts of a zip file; each part is unpacked only when it is read. */
export function unzip(buf: Buffer): { read: (name: string) => Buffer | null } {
  // The "end of central directory" record sits at the very end (a comment of up to 64 KB may follow it).
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new FileProblem(NOT_EXCEL);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new FileProblem(BROKEN);
    const nameLength = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength).replace(/\\/g, '/').replace(/^\//, '');
    entries.set(name.toLowerCase(), {
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      packedSize: buf.readUInt32LE(p + 20),
      offset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return {
    read(name) {
      const e = entries.get(name.replace(/^\//, '').toLowerCase());
      if (!e) return null;
      if (e.flags & 1) throw new FileProblem(OLD_OR_LOCKED);
      if (e.packedSize === 0xffffffff || e.offset === 0xffffffff) throw new FileProblem('The file is too big.');
      const at = e.offset;
      if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) throw new FileProblem(BROKEN);
      const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
      const data = buf.subarray(start, start + e.packedSize);
      if (e.method === 0) return data;
      if (e.method !== 8) throw new FileProblem(BROKEN);
      try {
        return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES });
      } catch {
        throw new FileProblem(BROKEN);
      }
    },
  };
}

// ======================================================================= XML bits

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML text -> plain text (&amp; &#38; and Excel's _x000D_ escapes). */
function decode(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
      if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m;
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    })
    .replace(/_x([0-9a-f]{4})_/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // characters XML 1.0 cannot hold at all
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Attributes of a tag, by name without the namespace prefix ("r:id" -> "id"). */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w.-]+:)?([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[2]] = decode(m[3] ?? m[4] ?? '');
  return out;
}

/** All the text of the <t> elements inside a piece of XML (rich text has several), without phonetic hints. */
function textOf(xml: string): string {
  const clean = xml.replace(/<(\w+:)?rPh\b[\s\S]*?<\/(\w+:)?rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)) out += decode(m[1] ?? '');
  return out;
}

/** "AB" -> 27 (0-based column number). */
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function columnLetters(index: number): string {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** "xl/" + "worksheets/sheet1.xml", "/xl/worksheets/sheet1.xml" or "../x.xml" -> a path inside the zip. */
function joinPath(dir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = dir.split('/').filter(Boolean);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece && piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

function relationships(xml: string | undefined): { id: string; type: string; target: string }[] {
  if (!xml) return [];
  return [...xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)>/g)].map((m) => {
    const a = attrs(m[1]);
    return { id: a.Id ?? '', type: a.Type ?? '', target: a.Target ?? '' };
  });
}

// ======================================================================= reading

/** Every visible sheet of an .xlsx file (or the one sheet of a CSV file). */
export function readWorkbook(buf: Buffer, fileName: string): Sheet[] {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0xe011cfd0) throw new FileProblem(OLD_OR_LOCKED);
  const isZip = buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
  if (!isZip) {
    if (/\.(xlsx|xlsm|xls)$/i.test(fileName)) throw new FileProblem(BROKEN);
    return [readCsv(buf, fileName)];
  }
  const z = unzip(buf);
  const text = (path: string) => z.read(path)?.toString('utf8');

  const root = relationships(text('_rels/.rels')).find((r) => r.type.endsWith('/officeDocument'));
  const bookPath = root ? joinPath('', root.target) : 'xl/workbook.xml';
  const book = text(bookPath);
  if (!book) throw new FileProblem(NOT_EXCEL);
  const bookDir = bookPath.includes('/') ? bookPath.slice(0, bookPath.lastIndexOf('/')) : '';
  const rels = relationships(text(joinPath(bookDir, `_rels/${bookPath.slice(bookDir.length).replace(/^\//, '')}.rels`)));
  const target = (id: string) => {
    const r = rels.find((x) => x.id === id);
    return r ? joinPath(bookDir, r.target) : null;
  };

  const pr = book.match(/<(?:\w+:)?workbookPr\b([^>]*)>/);
  const date1904 = !!pr && /^(1|true)$/i.test(attrs(pr[1]).date1904 ?? '');

  const sharedPath = rels.find((r) => r.type.endsWith('/sharedStrings'));
  const shared: string[] = [];
  const sst = sharedPath ? text(joinPath(bookDir, sharedPath.target)) : undefined;
  if (sst) for (const m of sst.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) shared.push(textOf(m[1] ?? ''));

  const sheets: Sheet[] = [];
  for (const m of book.matchAll(/<(?:\w+:)?sheet\b([^>]*)>/g)) {
    const a = attrs(m[1]);
    if (a.state === 'hidden' || a.state === 'veryHidden') continue;
    const path = target(a.id ?? '');
    const xml = path ? text(path) : undefined;
    if (!xml) continue; // a chart sheet or a missing part
    sheets.push({ name: a.name ?? 'Sheet', rows: readSheet(xml, shared), date1904 });
  }
  if (!sheets.length) throw new FileProblem('The file has no sheet with data.');
  return sheets;
}

/** Stops a file with a million rows from using up the server's memory. */
const MAX_SHEET_ROWS = 20_000;

function readSheet(xml: string, shared: string[]): Cell[][] {
  const rows: Cell[][] = [];
  let nextRow = 0;
  for (const rm of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const r = Number(attrs(rm[1]).r);
    const rowIndex = Number.isInteger(r) && r > 0 ? r - 1 : nextRow;
    nextRow = rowIndex + 1;
    if (!rm[2]) continue;
    const cells: Cell[] = [];
    let nextCol = 0;
    for (const cm of rm[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const a = attrs(cm[1]);
      const ref = (a.r ?? '').match(/^([A-Za-z]+)/);
      const col = ref ? columnIndex(ref[1]) : nextCol;
      nextCol = col + 1;
      const value = cellValue(a.t, cm[2] ?? '', shared);
      if (value === null || value === '') continue;
      while (cells.length < col) cells.push(null);
      cells[col] = value;
    }
    if (!cells.length) continue;
    if (rowIndex >= MAX_SHEET_ROWS) throw new FileProblem(`The sheet has more than ${MAX_SHEET_ROWS.toLocaleString('en-IN')} rows. Split it into smaller files.`);
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  return rows;
}

function cellValue(type: string | undefined, inner: string, shared: string[]): Cell {
  if (type === 'inlineStr') return textOf(inner.match(/<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/)?.[1] ?? '');
  const v = inner.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
  if (v === undefined) return null;
  const raw = decode(v);
  switch (type) {
    case 's':
      return shared[Number(raw)] ?? '';
    case 'str':
    case 'd':
      return raw;
    case 'b':
      return raw === '1' || raw.toLowerCase() === 'true';
    case 'e':
      return raw; // #N/A, #REF! ... shown to the user as the wrong value it is
    default: {
      if (raw.trim() === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
  }
}

/** CSV (comma, semicolon or tab separated) as one sheet. Accepts UTF-8 (with or without BOM) and Windows text. */
export function readCsv(buf: Buffer, fileName: string): Sheet {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = buf.toString('latin1');
  }
  text = text.replace(/^﻿/, '');
  if (/[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 2000))) throw new FileProblem(NOT_EXCEL);
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const sep = [',', ';', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');

  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cur = '';
  let quoted = false;
  const endCell = () => {
    row.push(cur.trim() === '' ? null : cur);
    cur = '';
  };
  const endRow = () => {
    endCell();
    if (rows.length >= MAX_SHEET_ROWS) throw new FileProblem(`The file has more than ${MAX_SHEET_ROWS.toLocaleString('en-IN')} rows. Split it into smaller files.`);
    rows.push(row.some((c) => c !== null) ? row : []);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === '') {
      cur = '';
      quoted = true;
    } else if (ch === sep) endCell();
    else if (ch === '\n') endRow();
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) endRow();
  return { name: fileName.replace(/\.[^.]+$/, '') || 'CSV', rows, date1904: false };
}

/** An Excel date number (days since 1900, or 1904) -> "YYYY-MM-DD". */
export function excelDate(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(base + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

// ======================================================================= writing

/** Cell looks in the template workbook (see STYLES below). */
export const STYLE = {
  plain: 0,
  headRequired: 1,
  head: 2,
  text: 3,
  date: 4,
  title: 5,
  tableHead: 6,
  tableCell: 7,
  wrap: 8,
  tableKey: 9,
} as const;

export interface OutCell {
  v: string | number;
  s?: number;
}

export interface OutSheet {
  name: string;
  hidden?: boolean;
  /** Width (characters) and the look new cells in the column get. */
  cols?: { width: number; style?: number }[];
  rows: (OutCell | null)[][];
  freezeTopRow?: boolean;
  /** Drop-down lists: cells `sqref` (e.g. "E2:E5001") choose from `source` (e.g. "Lists!$A$2:$A$6"). */
  lists?: { sqref: string; source: string; strict: boolean }[];
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mm\\-yyyy"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1F2A44"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><color rgb="FF1F2A44"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF4062C9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCE3F5"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFB8C2D9"/></left><right style="thin"><color rgb="FFB8C2D9"/></right><top style="thin"><color rgb="FFB8C2D9"/></top><bottom style="thin"><color rgb="FFB8C2D9"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="49" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function sheetXml(sheet: OutSheet, selected: boolean): string {
  const view = `<sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ''}>${
    sheet.freezeTopRow ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : ''
  }</sheetView></sheetViews>`;
  const cols = sheet.cols?.length
    ? `<cols>${sheet.cols
        .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"${c.style ? ` style="${c.style}"` : ''}/>`)
        .join('')}</cols>`
    : '';
  const rows = sheet.rows
    .map((cells, r) => {
      const inner = cells
        .map((c, i) => {
          if (!c) return '';
          const ref = `${columnLetters(i)}${r + 1}`;
          const s = c.s ? ` s="${c.s}"` : '';
          return typeof c.v === 'number'
            ? `<c r="${ref}"${s}><v>${c.v}</v></c>`
            : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
        })
        .join('');
      return inner ? `<row r="${r + 1}">${inner}</row>` : '';
    })
    .join('');
  const lists = sheet.lists?.length
    ? `<dataValidations count="${sheet.lists.length}">${sheet.lists
        .map(
          (l) =>
            `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"${l.strict ? '' : ' errorStyle="warning"'} errorTitle="Not in the list" error="${esc(
              l.strict ? 'Please choose a value from the list.' : 'This value is not in the list. Keep it anyway?',
            )}" sqref="${l.sqref}"><formula1>${esc(l.source)}</formula1></dataValidation>`,
        )
        .join('')}</dataValidations>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${MAIN}" xmlns:r="${REL}">${view}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${lists}<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

/** A small .xlsx workbook: text and number cells, column widths, frozen header row, drop-down lists. */
export function writeWorkbook(sheets: OutSheet[]): Buffer {
  const files: { name: string; data: string }[] = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
        .map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_s, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s, i === 0) })),
  ];
  return zip(files);
}
