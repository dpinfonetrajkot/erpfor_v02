-- Turns a copy of the old demo database into the DEMO LTD sample database.
-- Every company, customer, supplier and staff detail becomes a clear sample value
-- (example.com e-mails, 99999-style phones, AAAAA-style GSTINs, DEMO bank codes).
-- Run it on the NEW database only (erpforsell), never on a client database.
SET NAMES utf8mb4;
START TRANSACTION;

-- ---------------------------------------------------------------- company: one sample company, DEMO LTD
UPDATE invoices SET company_id = 1 WHERE company_id = 2;
UPDATE purchase_orders SET company_id = 1 WHERE company_id = 2;
DELETE FROM companies WHERE id = 2;
UPDATE companies SET
  code = 'DEMO',
  name = 'DEMO LTD',
  legal_name = 'DEMO LTD',
  address = 'Plot No. 25, Demo Industrial Estate, Main Road',
  city = 'Rajkot',
  state_code = '24',
  pincode = '360001',
  country = 'India',
  phone = '+91 98765 43210',
  email = 'info@example.com',
  website = 'www.example.com',
  gstin = '24AAAAA0000A1Z5',
  pan = 'AAAAA0000A',
  iec_code = 'AAAAA0000A',
  bank_name = 'Sample Bank Ltd.',
  bank_account_no = '000012345678',
  bank_ifsc = 'DEMO0000001',
  bank_branch = 'Rajkot Main Branch',
  swift_code = 'DEMOINBBXXX',
  is_default = 1,
  is_active = 1,
  updated_at = NOW(3)
WHERE id = 1;

-- invoice numbers carry the company code
UPDATE invoices SET invoice_no = 'DEMO/26-27/001' WHERE id = 1;
UPDATE invoices SET invoice_no = 'DEMO/26-27/002' WHERE id = 2;
UPDATE invoices SET invoice_no = 'DEMO/EXP/26-27/001' WHERE id = 3;
DELETE FROM document_counters WHERE period LIKE '%:BHT%';
INSERT INTO document_counters (series_code, period, last_number) VALUES
  ('INVOICE', 'FY2627:DEMO', 2),
  ('EXPORT_INVOICE', 'FY2627:DEMO', 1);
UPDATE document_series SET name = 'Heat number', updated_at = NOW(3) WHERE code = 'HEAT';

UPDATE purchase_orders SET delivery_address = 'DEMO LTD, Plot No. 25, Demo Industrial Estate, Main Road, Rajkot, Gujarat 360001'
WHERE delivery_address IS NOT NULL;
UPDATE dispatches SET challan_no = REPLACE(challan_no, 'BHT/', 'DEMO/') WHERE challan_no LIKE 'BHT/%';

-- ---------------------------------------------------------------- customers
UPDATE customers SET name = 'ALPHA OILFIELD SERVICES PVT. LTD.', contact_person = 'Ravi Kumar', phone = '+91 99999 10001',
  email = 'alpha.purchase@example.com', gstin = '24AAAAA1111A1Z1', pan = NULL, address = 'Plot No. 12, Sample Industrial Estate',
  shipping_address = NULL, updated_at = NOW(3) WHERE id = 1;
UPDATE customers SET name = 'BETA DRILLING EQUIPMENT CO.', contact_person = 'Sunil Rao', phone = '+91 99999 10002',
  email = 'beta.stores@example.com', gstin = '27BBBBB2222B1Z2', pan = NULL, address = 'Unit No. 304, Sample Business Park',
  shipping_address = 'Gate No. 4, Sample Logistics Park, Navi Mumbai - 400707', updated_at = NOW(3) WHERE id = 2;
UPDATE customers SET name = 'GAMMA PETROLEUM EQUIPMENT LLC', contact_person = 'Ahmed Ali', phone = '+971 4 000 0003',
  email = 'gamma.procurement@example.com', gstin = NULL, pan = NULL, address = 'Warehouse No. 14, Sample Free Zone',
  shipping_address = NULL, updated_at = NOW(3) WHERE id = 3;
UPDATE customers SET name = 'DELTA WELLHEAD SOLUTIONS', contact_person = 'Nikhil Desai', phone = '+91 99999 10004',
  email = 'delta.purchase@example.com', gstin = '24DDDDD4444D1Z4', pan = NULL, address = 'Plot No. 9, Sample GIDC Estate',
  shipping_address = NULL, updated_at = NOW(3) WHERE id = 4;

-- the buyer details copied onto each invoice
UPDATE invoices SET billing_name = 'ALPHA OILFIELD SERVICES PVT. LTD.', shipping_name = 'ALPHA OILFIELD SERVICES PVT. LTD.',
  billing_address = 'Plot No. 12, Sample Industrial Estate, Jamnagar, Gujarat, 361004', shipping_address = NULL,
  billing_gstin = '24AAAAA1111A1Z1', shipping_gstin = '24AAAAA1111A1Z1' WHERE id = 1;
UPDATE invoices SET billing_name = 'BETA DRILLING EQUIPMENT CO.', shipping_name = 'BETA DRILLING EQUIPMENT CO.',
  billing_address = 'Unit No. 304, Sample Business Park, Navi Mumbai, Maharashtra, 400705',
  shipping_address = 'Gate No. 4, Sample Logistics Park, Navi Mumbai - 400707',
  billing_gstin = '27BBBBB2222B1Z2', shipping_gstin = '27BBBBB2222B1Z2' WHERE id = 2;
UPDATE invoices SET billing_name = 'GAMMA PETROLEUM EQUIPMENT LLC', shipping_name = 'GAMMA PETROLEUM EQUIPMENT LLC',
  billing_address = 'Warehouse No. 14, Sample Free Zone, Dubai, United Arab Emirates', shipping_address = NULL,
  billing_gstin = NULL, shipping_gstin = NULL WHERE id = 3;

-- ---------------------------------------------------------------- suppliers
UPDATE suppliers SET name = 'OMEGA ALLOY STEELS PVT. LTD.', contact_person = 'Vikas Jain', phone = '+91 99999 20001',
  email = 'omega.sales@example.com', gstin = '24EEEEE5555E1Z5', pan = NULL, address = 'Plot No. 42, Sample Industrial Estate',
  bank_name = NULL, bank_account_no = NULL, bank_ifsc = NULL, updated_at = NOW(3) WHERE id = 1;
UPDATE suppliers SET name = 'SIGMA STEEL TRADERS', contact_person = 'Anil Patil', phone = '+91 99999 20002',
  email = 'sigma.steel@example.com', gstin = '27FFFFF6666F1Z6', pan = NULL, address = 'Plot No. 18, Sample MIDC',
  bank_name = NULL, bank_account_no = NULL, bank_ifsc = NULL, updated_at = NOW(3) WHERE id = 2;
UPDATE suppliers SET name = 'KAPPA MACHINING WORKS', contact_person = 'Hardik Patel', phone = '+91 99999 20003',
  email = 'kappa.works@example.com', gstin = '24GGGGG7777G1Z7', pan = NULL, address = 'Shed No. 7, Sample GIDC',
  bank_name = NULL, bank_account_no = NULL, bank_ifsc = NULL, updated_at = NOW(3) WHERE id = 3;

-- ---------------------------------------------------------------- old names inside remarks, logs and chat
UPDATE audit_logs SET summary =
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(summary,
    'SAURASHTRA OILFIELD SERVICES PVT. LTD.', 'ALPHA OILFIELD SERVICES PVT. LTD.'),
    'DECCAN DRILLING EQUIPMENT CO.', 'BETA DRILLING EQUIPMENT CO.'),
    'AL NOOR PETROLEUM EQUIPMENT LLC', 'GAMMA PETROLEUM EQUIPMENT LLC'),
    'CAMBAY WELLHEAD SOLUTIONS', 'DELTA WELLHEAD SOLUTIONS'),
    'SHREE GANESH ALLOY STEELS PVT. LTD.', 'OMEGA ALLOY STEELS PVT. LTD.'),
    'MAHALAXMI STEEL TRADERS', 'SIGMA STEEL TRADERS'),
    'PRECISION MACHINING WORKS', 'KAPPA MACHINING WORKS'),
    'As per BHT standard drawing', 'As per standard drawing');
UPDATE audit_logs SET summary = REPLACE(summary, 'BHTPL/', 'DEMO/') WHERE summary LIKE '%BHTPL/%';
UPDATE audit_logs SET summary = REPLACE(summary, 'BHTF/', 'DEMO/') WHERE summary LIKE '%BHTF/%';
UPDATE stock_ledger SET remarks = REPLACE(remarks, 'PRECISION MACHINING WORKS', 'KAPPA MACHINING WORKS') WHERE remarks LIKE '%PRECISION MACHINING WORKS%';
UPDATE chat_messages SET body = REPLACE(body, 'Cambay Wellhead', 'Delta Wellhead') WHERE body LIKE '%Cambay Wellhead%';
UPDATE purchase_requisitions SET remarks = REPLACE(remarks, 'Saurashtra Oilfield', 'Alpha Oilfield') WHERE remarks LIKE '%Saurashtra Oilfield%';
UPDATE safety_assets SET vendor_agency = 'Sample Crane Services' WHERE vendor_agency = 'Saurashtra Crane Services';
UPDATE sales_order_approvals SET remarks = REPLACE(remarks, 'As per BHT standard drawing', 'As per standard drawing') WHERE remarks LIKE '%BHT%';
UPDATE route_card_operations SET remarks = REPLACE(remarks, 'stamp: BHT,', 'stamp: DEMO,') WHERE remarks LIKE '%stamp: BHT,%';
UPDATE job_work_orders SET remarks = REPLACE(remarks, 'BHT-602-2-THD', 'DWG-602-2-THD') WHERE remarks LIKE '%BHT-602-2-THD%';
UPDATE payments SET reference = CONCAT('UTR', LPAD(id, 10, '0')) WHERE reference IS NOT NULL AND reference <> '';
-- terms: the sample company is in Rajkot (the old text named another city)
UPDATE invoices SET terms = REPLACE(terms, 'Subject to Jamnagar jurisdiction.', 'Subject to Rajkot jurisdiction.') WHERE terms LIKE '%Jamnagar jurisdiction%';
UPDATE companies SET invoice_terms = '1. Interest @ 18% p.a. will be charged if payment is not made within the due date.
2. Our responsibility ceases once the goods leave our premises.
3. Subject to Rajkot jurisdiction.' WHERE code = 'DEMO';

-- ---------------------------------------------------------------- staff: sample contact and bank details
UPDATE users SET email = REPLACE(email, '@bhtforge.com', '@example.com') WHERE email LIKE '%@bhtforge.com';
UPDATE employees SET
  phone = CONCAT('99990', LPAD(emp_code, 5, '0')),
  uan = IF(uan IS NULL, NULL, CONCAT('1000000', LPAD(emp_code, 5, '0'))),
  bank_name = IF(bank_account_no IS NULL, NULL, 'Sample Bank Ltd.'),
  bank_ifsc = IF(bank_account_no IS NULL, NULL, CONCAT('DEMO0', LPAD(emp_code, 6, '0'))),
  bank_account_no = IF(bank_account_no IS NULL, NULL, CONCAT('0000000', LPAD(emp_code, 5, '0'))),
  updated_at = NOW(3);

COMMIT;
