/**
 * Reading a question typed by staff: words (Gujarati / Hindi words written in English letters
 * are turned into English), the period ("last month", "september", "21 oct"), document numbers
 * (SO/26-27/0003, "so 3") and codes (heat A102602, LAP-01). No outside service - plain rules.
 */

export interface Period {
  from: string;
  to: string;
  label: string;
  /** Set when the period is exactly one calendar month (YYYY-MM). */
  month?: string;
}

export interface Parsed {
  raw: string;
  /** Lower case, synonyms replaced, document numbers and dates taken out; padded with spaces. */
  padded: string;
  words: Set<string>;
  period: Period | null;
  /** Full document numbers in upper case, e.g. SO/26-27/0003. */
  docs: string[];
  /** Short forms such as "so 3" or "invoice 12". */
  shortDocs: { kind: DocKind; num: number }[];
  /** Plain numbers left in the question (sizes, codes, quantities). */
  numbers: string[];
  /** Words with letters and digits: heat numbers, asset codes, grades (a105, ss316). */
  codes: string[];
  /** Misspelt words read as a known word ("atendance" -> "attendance"). */
  corrections: { from: string; to: string }[];
}

export type DocKind = 'SO' | 'PO' | 'RC' | 'JWO' | 'INVOICE' | 'DISPATCH' | 'GRN';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const monthIndex = (m: string) => MONTHS.indexOf(m.slice(0, 3));

/** Gujarati / Hindi words people type in English letters, and short forms, turned into one English word. */
const SYNONYMS: [RegExp, string][] = [
  [/\b(gai ?kale|gaikal)\b/g, 'yesterday'],
  [/\b(aavti ?kale|aavtikal)\b/g, 'tomorrow'],
  [/\b(aaje|aaj|aj|todays)\b/g, 'today'],
  [/\b(gaya|gayo|gayu|pichhla|pichla|pichhle|pichle|pichhlo) (mahine|mahino|mahina)\b/g, 'last month'],
  [/\b(aa|is|ish) (mahine|mahino|mahina)\b/g, 'this month'],
  [/\b(nathi aavya|nathi avya|nathi aavyo|nahi aaye|nahi aaya|nahi aayi|not present|absence)\b/g, 'absent'],
  [/\b(gerhajar|gairhajar|ghairhajar|gerhazar|did ?n[o']?t come|not come|not came|absentees?)\b/g, 'absent'],
  [/\b(hajar|haajar|hazar|came|punched in|on duty|aavya|avya|aaye|aaya)\b/g, 'present'],
  [/\b(pagar|wages?|salaries|tankhwah|tankha)\b/g, 'salary'],
  [/\b(upad|udhar|advances)\b/g, 'advance'],
  [/\b(chutti|chhutti|raja|rajaa|leaves)\b/g, 'leave'],
  [/\b(ketla|ketlu|ketli|kitna|kitne|kitni)\b/g, 'how many'],
  [/\b(log|loko|manas|karigar|karigaro)\b/g, 'people'],
  [/\b(baki|bakki|baaki|bakaya)\b/g, 'pending'],
  [/\b(vechan|bikri|bikari|vikri)\b/g, 'sales'],
  [/\b(maal|stok|stocks)\b/g, 'stock'],
  [/\b(kon|kaun)\b/g, 'who'],
  [/\b(che|chhe|hai|hain|batao|batavo|bataao|kaho|dikhao|please|pls|plz|kindly)\b/g, ' '],
  [/\bfinished goods?\b/g, 'fg'],
  [/\braw materials?\b/g, 'rm'],
  [/\bpurchase orders?\b/g, 'po'],
  [/\bsales orders?\b/g, 'so'],
  [/\broute ?cards?\b/g, 'rc'],
  [/\bjob ?work orders?\b/g, 'jwo'],
  [/\bgate entr(?:y|ies)\b/g, 'grn'],
  [/\bss\s+(3\d\d)\b/g, 'ss$1'],
  [/\b(\d+(?:\.\d+)?)\s*(?:"|''|inch(?:es)?)/g, '$1 inch'],
  [/\b(\d+(?:\.\d+)?)\s*mm\b/g, '$1 mm'],
  [/\b(\d+(?:\.\d+)?)\s*x\s*(?=\d)/g, '$1 x '],
];

const pad2 = (n: number) => String(n).padStart(2, '0');
export const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const fmtDay = (date: string) => `${Number(date.slice(8, 10))} ${MONTH_NAMES[Number(date.slice(5, 7)) - 1].slice(0, 3)} ${date.slice(0, 4)}`;
export const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** A whole calendar month, cut at today when it is the current month. */
export function monthPeriod(month: string, today: string): Period {
  const [y, m] = month.split('-').map(Number);
  const end = ymd(y, m, lastDay(y, m));
  return { from: `${month}-01`, to: end > today ? today : end, label: monthLabel(month), month };
}

export function dayPeriod(date: string, label?: string): Period {
  return { from: date, to: date, label: label ?? fmtDay(date) };
}

/** Indian financial year (April to March) holding the date. */
export function financialYear(date: string) {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `${start}-${String(start + 1).slice(2)}` };
}

/** Finds the period in the text; returns it and the text without the words used. */
function readPeriod(text: string, today: string): { period: Period | null; text: string } {
  const [ty, tm] = today.split('-').map(Number);
  const take = (re: RegExp, make: (m: RegExpMatchArray) => Period | null) => {
    const m = text.match(re);
    if (!m) return null;
    const period = make(m);
    if (period) text = text.replace(m[0], ' ');
    return period;
  };
  const yearOf = (monthNo: number, y?: string) => (y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : monthNo <= tm ? ty : ty - 1);
  const validDate = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= lastDay(y, m);

  const period =
    take(/\b(?:last|past|previous) (\d{1,3}) days?\b/, (m) => {
      const n = Math.min(366, Math.max(1, Number(m[1])));
      return { from: addDays(today, -(n - 1)), to: today, label: `last ${n} days` };
    }) ??
    take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => (validDate(+m[1], +m[2], +m[3]) ? dayPeriod(m[0]) : null)) ??
    take(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/, (m) => {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return validDate(y, +m[2], +m[1]) ? dayPeriod(ymd(y, +m[2], +m[1])) : null;
    }) ??
    take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\.?(?:,?\\s+(\\d{4}))?\\b`), (m) => {
      const mo = monthIndex(m[2]) + 1;
      const y = yearOf(mo, m[3]);
      return validDate(y, mo, +m[1]) ? dayPeriod(ymd(y, mo, +m[1])) : null;
    }) ??
    take(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b(?!\\s*(?:inch|mm|kg|pcs|x))`), (m) => {
      const mo = monthIndex(m[1]) + 1;
      const y = yearOf(mo, m[3]);
      return validDate(y, mo, +m[2]) ? dayPeriod(ymd(y, mo, +m[2])) : null;
    }) ??
    take(/\btoday\b/, () => dayPeriod(today, 'today')) ??
    take(/\byesterday\b/, () => dayPeriod(addDays(today, -1), 'yesterday')) ??
    take(/\btomorrow\b/, () => dayPeriod(addDays(today, 1), 'tomorrow')) ??
    take(/\b(?:this|current) week\b/, () => {
      const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
      return { from: addDays(today, -dow), to: today, label: 'this week' };
    }) ??
    take(/\b(?:last|previous) week\b/, () => {
      const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
      return { from: addDays(today, -dow - 7), to: addDays(today, -dow - 1), label: 'last week' };
    }) ??
    take(/\b(?:this|current) month\b/, () => ({ ...monthPeriod(today.slice(0, 7), today), label: `this month (${monthLabel(today.slice(0, 7))})` })) ??
    take(/\b(?:last|previous) month\b/, () => monthPeriod(tm === 1 ? `${ty - 1}-12` : `${ty}-${pad2(tm - 1)}`, today)) ??
    // 2025-26 is a financial year, 2026-10 a month
    take(/\bfy\s*(\d{2}|\d{4})\s*-\s*(\d{2})\b|\b(20\d{2})-(\d{2})\b/, (m) => {
      const start = Number(m[1] ?? m[3]);
      const y = start < 100 ? 2000 + start : start;
      const second = Number(m[2] ?? m[4]);
      if (!m[1] && second !== (y + 1) % 100) return second >= 1 && second <= 12 ? monthPeriod(`${y}-${pad2(second)}`, today) : null;
      const fy = financialYear(`${y}-04-01`);
      return { from: fy.from, to: fy.to < today ? fy.to : today, label: `FY ${fy.label}` };
    }) ??
    take(/\b(?:last|previous) (?:fy|financial year|year)\b/, () => {
      const fy = financialYear(addDays(financialYear(today).from, -1));
      return { from: fy.from, to: fy.to, label: `FY ${fy.label}` };
    }) ??
    take(/\b(?:this|current) (?:fy|financial year|year)\b|\b(?:fy|financial year|year to date|ytd)\b/, () => {
      const fy = financialYear(today);
      return { from: fy.from, to: today, label: `FY ${fy.label} so far` };
    }) ??
    // "may" is also an English word: only as a month next to a year or after in / of / for / during
    take(new RegExp(`\\b(?:(?:in|of|for|during)\\s+)?(${MONTH_RE.replace('may|', '')})\\b\\.?(?:\\s*[-']?\\s*(\\d{4}|\\d{2}))?|\\b(?:in|of|for|during)\\s+(may)\\b(?:\\s+(\\d{4}))?|\\b(may)\\s+(\\d{4})\\b`), (m) => {
      const name = m[1] ?? m[3] ?? m[5];
      const yr = m[2] ?? m[4] ?? m[6];
      const mo = monthIndex(name) + 1;
      const y = yearOf(mo, yr);
      return monthPeriod(`${y}-${pad2(mo)}`, today);
    });
  return { period, text };
}

const DOC_RE = /\b([A-Z]{2,6}(?:\/[A-Z]{2,4})?\/\d{2}-\d{2}\/\d{1,5})\b/g;
const SHORT_DOC: [RegExp, DocKind][] = [
  [/\bso\s*(?:no\.?|number|#)?\s*(\d{1,5})\b/g, 'SO'],
  [/\bpo\s*(?:no\.?|number|#)?\s*(\d{1,5})\b/g, 'PO'],
  [/\brc\s*(?:no\.?|number|#)?\s*(\d{1,5})\b/g, 'RC'],
  [/\bjwo\s*(?:no\.?|number|#)?\s*(\d{1,5})\b/g, 'JWO'],
  [/\b(?:invoice|inv|bill)\s*(?:no\.?|number|#)?\s*(\d{1,5})\b/g, 'INVOICE'],
  [/\b(?:dispatch|dc|challan)\s*(?:no\.?|number|#)?\s*(\d{1,5})\b/g, 'DISPATCH'],
  [/\bgrn\s*(?:no\.?|number|#)?\s*(\d{1,5})\b/g, 'GRN'],
];

/** Words that never name a customer, supplier or employee on their own. */
export const COMMON_WORDS = new Set(
  (
    'a an the and or of for in on at to from by with is are was were be been am do does did done have has had will would can could should ' +
    'i me my we us our you your he she it its they them their this that these those there here what which who whom whose where when why how ' +
    'many much more most less all any some each every no not yes ok show tell give list find get see check know want need please about ' +
    'total amount value number count status details detail info information report summary latest last next this current today ' +
    'stock order orders sales sale invoice invoices bill po so rc grn jwo dispatch payment payments pending open due overdue late ' +
    'customer customers supplier suppliers vendor vendors party employee employees staff worker workers people ' +
    'field services service steel steels oil oilfield equipment engineering engineers industries industry trading traders enterprises ' +
    'solutions petroleum drilling metal metals forge forging forgings india international global company corporation co ltd limited ' +
    'pvt private llp llc inc group works work time new old month year day days week'
  ).split(/\s+/),
);

/** Words the assistant works with; a word typed with a small spelling mistake is read as the nearest of these. */
const VOCABULARY = [
  ...'stock available balance store inventory quantity pieces material materials round square finished parts reorder shortage'.split(' '),
  ...'status order orders pending overdue delayed dispatch dispatched delivery deliveries supply backlog route cards stage stages progress running'.split(' '),
  ...'purchase requisition requisitions trace traceability customer customers supplier suppliers vendor vendors products items'.split(' '),
  ...'rejection rejections rejected scrap production produced output manufactured sales turnover revenue billing billed invoiced'.split(' '),
  ...'outstanding receivable receivables collection unpaid payable payables invoice invoices payment payments'.split(' '),
  ...'attendance absent present punch punches punched missing overtime hours leave holiday approval waiting approve'.split(' '),
  ...'loan loans advance salary payslip payroll employee employees details phone mobile contact joined joining department designation address birthday'.split(' '),
  ...'safety extinguisher extinguishers hydrant crane inspection inspections asset assets laptop laptops computer instrument workers people users'.split(' '),
  ...'today yesterday tomorrow month week year financial january february march april june july august september october november december'.split(' '),
  ...'hammer union female quality gerhajar hajar pagar chutti'.split(' '),
];
const VOCAB = new Set(VOCABULARY);

/** Edit distance with swapped neighbours counted as one change ("atendance", "attendnace"). */
function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = limit + 1;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      best = Math.min(best, d[i][j]);
    }
    if (best > limit) return limit + 1;
  }
  return d[a.length][b.length];
}

/** The one known word close to a misspelt word: 1 change for 5-7 letters, 2 for longer words; none when two fit. */
function closest(word: string): string | null {
  const limit = word.length >= 8 ? 2 : 1;
  let best: string | null = null;
  let bestD = limit + 1;
  let tie = false;
  for (const v of VOCABULARY) {
    const d = distance(word, v, limit);
    if (d < bestD) [best, bestD, tie] = [v, d, false];
    else if (d === bestD && v !== best) tie = true;
  }
  return best && !tie ? best : null;
}

/**
 * Splits a question into its parts. `today` is the India date (YYYY-MM-DD).
 * `names` are words of customers, employees, parts ... that must never be "corrected".
 */
export function parseQuestion(raw: string, today: string, names: Set<string> = new Set()): Parsed {
  let text = raw.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

  const docs = [...new Set([...text.toUpperCase().matchAll(DOC_RE)].map((m) => m[1]))];
  text = text.toUpperCase().replace(DOC_RE, ' ').toLowerCase();
  const corrections: Parsed['corrections'] = [];
  text = text.replace(/\b[a-z]{5,}\b/g, (w) => {
    // known words, names, and Gujarati / Hindi words handled below are left as they are
    if (VOCAB.has(w) || COMMON_WORDS.has(w) || names.has(w) || SYNONYMS.some(([re]) => new RegExp(re.source).test(w))) return w;
    const fix = closest(w);
    if (!fix) return w;
    corrections.push({ from: w, to: fix });
    return fix;
  });
  for (const [re, to] of SYNONYMS) text = text.replace(re, to);

  const read = readPeriod(text, today);
  text = read.text;

  const shortDocs: Parsed['shortDocs'] = [];
  for (const [re, kind] of SHORT_DOC) {
    for (const m of text.matchAll(re)) shortDocs.push({ kind, num: Number(m[1]) });
    text = text.replace(re, ` ${kind.toLowerCase()} `);
  }

  const tokens = text
    .replace(/[^a-z0-9.&/\- ]+/g, ' ')
    .split(/[\s/]+/)
    .map((t) => t.replace(/^[.\-&]+|[.\-&]+$/g, ''))
    .filter(Boolean);
  const numbers = tokens.filter((t) => /^\d+(?:\.\d+)?$/.test(t));
  const codes = tokens.filter((t) => /[a-z]/.test(t) && /\d/.test(t));
  const words = new Set(tokens.flatMap((t) => (t.includes('-') ? [t, ...t.split('-')] : [t])));
  return {
    raw,
    padded: ` ${tokens.join(' ')} `,
    words,
    period: read.period,
    docs,
    shortDocs,
    numbers,
    codes,
    corrections,
  };
}

/** True when any of the words or phrases is in the question. */
export const has = (p: Parsed, ...terms: string[]) => terms.some((t) => p.padded.includes(` ${t} `));

/** Number of the words or phrases found, for scoring. */
export const hits = (p: Parsed, terms: string[]) => terms.filter((t) => p.padded.includes(` ${t} `)).length;

/** Lower-case words of a name (for matching), e.g. `2" FIG 1502 MALE BW` -> 2 inch fig 1502 male bw. */
export function nameTokens(name: string): string[] {
  let t = name.toLowerCase().replace(/[“”]/g, '"');
  for (const [re, to] of SYNONYMS.slice(-4)) t = t.replace(re, to);
  return t
    .replace(/[^a-z0-9. ]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}
