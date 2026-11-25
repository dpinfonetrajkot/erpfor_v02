/**
 * Tally import XML (TallyPrime and Tally.ERP 9): ENVELOPE > HEADER (Import Data) > BODY > IMPORTDATA >
 * REQUESTDESC (REPORTNAME "All Masters" or "Vouchers") > REQUESTDATA > TALLYMESSAGE per ledger / voucher.
 * Amounts follow Tally's rule: a debit is negative with ISDEEMEDPOSITIVE Yes, a credit positive with No.
 * All amounts here are whole paise, so a voucher always balances exactly.
 */

export interface TallyLedger {
  name: string;
  /** Tally group, e.g. Sundry Debtors, Duties & Taxes. */
  parent: string;
  /** Parties: keep bill-by-bill details (invoice numbers) in Tally. */
  billWise?: boolean;
  mailingName?: string;
  address?: string[];
  state?: string | null;
  country?: string | null;
  pincode?: string | null;
  gstRegistrationType?: 'Regular' | 'Unregistered' | null;
  gstin?: string | null;
  pan?: string | null;
  email?: string | null;
  phone?: string | null;
  contact?: string | null;
  /** GST tax ledgers: Central Tax / State Tax / Integrated Tax. */
  gstDutyHead?: string;
}

export interface TallyEntry {
  ledger: string;
  /** Paise. Negative = debit, positive = credit (Tally's sign). */
  amount: number;
  isParty?: boolean;
  bill?: { name: string; type: 'New Ref' | 'Agst Ref' | 'Advance' | 'On Account' };
}

export interface TallyVoucher {
  voucherType: string;
  /** YYYY-MM-DD */
  date: string;
  number: string;
  reference?: string | null;
  party: string;
  narration: string;
  entries: TallyEntry[];
}

/** XML text: escapes the five special characters and drops characters XML cannot hold. */
export function esc(value: string): string {
  return value
    .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 1234567 paise -> "12345.67", -5 -> "-0.05" */
export function money(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const tag = (name: string, value: string | null | undefined) => (value ? `<${name}>${esc(value)}</${name}>` : '');
const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

export function ledgerXml(l: TallyLedger): string {
  const parts = [
    // no ACTION: Tally then follows the "if the master already exists" choice made on the import screen
    `<LEDGER NAME="${esc(l.name)}">`,
    tag('NAME', l.name),
    tag('PARENT', l.parent),
    l.billWise ? '<ISBILLWISEON>Yes</ISBILLWISEON>' : '',
    l.mailingName ? `<MAILINGNAME.LIST TYPE="String">${tag('MAILINGNAME', l.mailingName)}</MAILINGNAME.LIST>` : '',
    l.address?.length ? `<ADDRESS.LIST TYPE="String">${l.address.map((a) => tag('ADDRESS', a)).join('')}</ADDRESS.LIST>` : '',
    tag('LEDSTATENAME', l.state),
    tag('COUNTRYNAME', l.country),
    tag('PINCODE', l.pincode),
    tag('GSTREGISTRATIONTYPE', l.gstRegistrationType),
    tag('PARTYGSTIN', l.gstin),
    tag('INCOMETAXNUMBER', l.pan),
    tag('EMAIL', l.email),
    tag('LEDGERPHONE', l.phone),
    tag('LEDGERCONTACT', l.contact),
    l.gstDutyHead ? `<TAXTYPE>GST</TAXTYPE>${tag('GSTDUTYHEAD', l.gstDutyHead)}` : '',
    '</LEDGER>',
  ];
  return parts.filter(Boolean).join('');
}

/** Throws when the debits and credits do not match (that would be refused by Tally). */
export function voucherXml(v: TallyVoucher): string {
  const entries = v.entries.filter((e) => e.amount !== 0);
  const sum = entries.reduce((s, e) => s + e.amount, 0);
  if (sum !== 0) throw new Error(`${v.voucherType} ${v.number} does not balance (difference ${money(sum)})`);
  const date = v.date.replace(/-/g, '');
  const lines = entries.map((e) =>
    [
      '<LEDGERENTRIES.LIST>',
      tag('LEDGERNAME', e.ledger),
      `<ISDEEMEDPOSITIVE>${yesNo(e.amount < 0)}</ISDEEMEDPOSITIVE>`,
      e.isParty ? '<ISPARTYLEDGER>Yes</ISPARTYLEDGER>' : '',
      `<AMOUNT>${money(e.amount)}</AMOUNT>`,
      e.bill ? `<BILLALLOCATIONS.LIST>${tag('NAME', e.bill.name)}${tag('BILLTYPE', e.bill.type)}<AMOUNT>${money(e.amount)}</AMOUNT></BILLALLOCATIONS.LIST>` : '',
      '</LEDGERENTRIES.LIST>',
    ].join(''),
  );
  return [
    `<VOUCHER VCHTYPE="${esc(v.voucherType)}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
    `<DATE>${date}</DATE>`,
    `<EFFECTIVEDATE>${date}</EFFECTIVEDATE>`,
    tag('VOUCHERTYPENAME', v.voucherType),
    tag('VOUCHERNUMBER', v.number),
    tag('REFERENCE', v.reference),
    tag('PARTYLEDGERNAME', v.party),
    '<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>',
    '<ISINVOICE>No</ISINVOICE>',
    tag('NARRATION', v.narration),
    ...lines,
    '</VOUCHER>',
  ].join('');
}

/** The whole import file. `report` is "All Masters" for ledgers, "Vouchers" for vouchers. */
export function envelope(report: 'All Masters' | 'Vouchers', messages: string[]): string {
  return [
    '<ENVELOPE>',
    '<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>',
    '<BODY><IMPORTDATA>',
    `<REQUESTDESC><REPORTNAME>${report}</REPORTNAME></REQUESTDESC>`,
    '<REQUESTDATA>',
    ...messages.map((m) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">\n${m}\n</TALLYMESSAGE>`),
    '</REQUESTDATA>',
    '</IMPORTDATA></BODY>',
    '</ENVELOPE>',
    '',
  ].join('\n');
}
