# Manufacturing ERP

ERP for forging, casting and machining companies: purchase, gate entry and QC, stock by heat number, sales orders
with approvals, route cards and job work, packing, GST invoices, dispatch, payments, reports, HR and payroll.
The sample company is **DEMO LTD**; each client sets its own name, address, GSTIN and bank in *Admin → Companies*
and its own screen name with the `NEXT_PUBLIC_BRAND_*` settings (see *A new client* below).

| Part | Technology |
|---|---|
| Web app | Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · Radix UI · TanStack Query/Table · React Hook Form |
| API | NestJS 11 · Prisma 7 · JWT in http-only cookies · role-based permissions · audit log |
| Database | MySQL 8 (MariaDB 11 also works) · 68 tables · real foreign keys · one collation |
| Shared | `packages/shared` — permission list, enums and **zod validation rules used by both web and API** |

## Folder structure

```
erpforsellnew/
├─ apps/
│  ├─ api/                     NestJS API  (http://localhost:4500/api)
│  │  ├─ prisma/schema.prisma  the whole database, all modules
│  │  ├─ prisma/migrations/    SQL migrations (never edit by hand)
│  │  ├─ prisma/seed.ts        roles, admin user, companies, stages, number formats
│  │  ├─ scripts/import-legacy.ts   example importer from an old PHP ERP (adapt per client)
│  │  └─ src/
│  │     ├─ auth/              login, refresh tokens, guard (login + permission check)
│  │     ├─ admin/             users, roles, companies, number series, audit log
│  │     ├─ masters/           customers, suppliers, products/BOM, items, raw materials, heats, stages, tools
│  │     ├─ purchase/          requisitions, purchase orders, PO PDF (pdfkit) + e-mail
│  │     ├─ receipts/          gate entry + incoming QC (creates heats, puts material in stock)
│  │     ├─ inventory/         stock by heat, ledger, CSV export, adjustments
│  │     ├─ sales/             sales orders, approvals, stock check, production requests
│  │     ├─ production/        route cards + stages, material request / issue, completion → FG stock, route card PDF
│  │     ├─ jobwork/           job work orders, material to vendors, receipts + QC, job work challan PDF
│  │     ├─ billing/           packing (sets by heat), GST invoices + PDF, dispatch + packing list, payments
│  │     ├─ reports/           traceability (+ PDFs), stock, production, sales / GST, purchases, ageing
│  │     ├─ hr/                employees, attendance + biometric machines (/iclock), leave, loans, payroll + payslip PDF, assets
│  │     ├─ assistant/         "Ask ERP": questions in plain words answered from the ERP data (no outside service)
│  │     ├─ communication/     chat (direct + groups) and the notification bell; core/live-updates.ts = /events stream
│  │     ├─ core/              audit, document numbering, stock ledger, mail (shared by all modules)
│  │     ├─ files/             attachments (MTC, drawings, reports)
│  │     └─ common/            validation pipe, error filter, list/paging helpers
│  └─ web/                     Next.js web app  (http://localhost:3500)
│     └─ src/
│        ├─ app/(app)/         screens behind login
│        ├─ app/login/         sign-in page
│        ├─ components/ui/     buttons, inputs, dialogs … (design system)
│        └─ components/app/    shell, data table, forms, permission gate
├─ packages/shared/            permissions, constants, zod schemas
└─ docker-compose.yml          optional: MySQL in docker + Mailpit e-mail catcher
```

## First-time setup (developer PC)

Needs **Node 22+**, **pnpm** and **MySQL 8** (the normal Windows installer with Workbench is fine).

1. In MySQL Workbench create two empty databases:
   ```sql
   CREATE DATABASE erpforsell CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE DATABASE erpforsell_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;  -- Prisma uses it to make migrations
   ```
2. Then:
   ```bash
   pnpm install
   cp apps/api/.env.example apps/api/.env      # put your MySQL password in DATABASE_URL, change JWT_ACCESS_SECRET
   cp apps/web/.env.example apps/web/.env
   pnpm --filter @bht/api db:deploy            # create all tables
   pnpm db:seed                                # roles, admin user, companies, stages ...
   npm run dev                                 # API :4500 + web :3500  (pnpm dev works too)
   ```

`npm run dev` first stops dev servers of this project left running from an earlier run (on Windows, Ctrl+C can leave
them behind and the next start fails with **"address already in use"**). `npm run dev:stop` does only that cleanup.
If another program uses port 4500 or 3500, it is reported and left alone.
After the database structure changes (a new folder in `apps/api/prisma/migrations`), stop `npm run dev` (Ctrl+C),
run `pnpm --filter @bht/api db:deploy`, and start it again.

Times are stored in UTC; the API sets each database connection to UTC, so a MySQL server on India time is fine.
Docker is optional: `pnpm db:up` starts MySQL on port 3307 and **Mailpit** (http://localhost:8025), which catches
every e-mail in development. Without Mailpit, "E-mail to supplier" fails until a real SMTP server is set in `.env`.

Open http://localhost:3500 and sign in with `admin` / the `SEED_ADMIN_PASSWORD` from `apps/api/.env`.
**Change that password at once** (user menu → Change password).

## Purchase → gate entry → QC → stock (phase 2)

1. **Requisition** (Store/Production): what material is needed. *Reorder suggestions* lists materials below their reorder level.
2. **Purchase order** (Accounts): tick requisitions → *Create purchase order*, or start a new one. GST is chosen from the
   supplier's state (CGST+SGST / IGST / none for imports), totals and amount-in-words are calculated, the company's terms are filled in.
   Save as draft → **Approve & issue** → *View PDF* / *E-mail to supplier* (PDF attached).
3. **Gate entry** (Store/Security): choose supplier + PO; the quantities still to come are filled in. Enter mill heat no., vehicle, challan.
4. **Incoming QC** (QC): accept / reject each line (reason needed for rejection). Accepted material gets its own **heat number**
   (automatic A + month + year + running no., or type an existing one when the same heat arrives again) and goes into the RM store.
   The PO becomes *Part received* / *Received* by itself. Upload the MTC on the heat.
5. **Stock & ledger**: stock by heat (oldest first), every movement, Excel (CSV) export, adjustments with a reason.

E-mail: in development every mail is caught by Mailpit (http://localhost:8025) and nothing reaches real suppliers.
For production put the real SMTP server in `apps/api/.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`).

## Sales order → approvals → stock check → production (phase 3)

1. **Sales order** (Sales): customer, customer PO no. (warns if already used), delivery date, and per product the end
   connection (BW / THD — only for products whose parts have one), service (Standard / Sour NACE), schedule, grade,
   qty and rate. Attach drawings and the customer PO copy. Save as draft → **Send for approval**.
2. **Feasibility** (Production): decide *In-house* or *Outsource* for every product. This comes first.
3. **Design** (Design) and **Production** (Production) approvals, in any order, after feasibility.
   A rejection needs a reason and sends the order back to Sales; after the change all three approve again.
4. When all three approve, the order is *Approved* and shows the **stock check**: per part, how many are needed, in the FG
   store, already asked from production, and short. Send the shortage to production as **production requests**
   (`PRQ/26-27/0001`); the order becomes *In production*.
5. **Production requests**: everything production is asked to make, including **make-to-stock** requests without an order.
   Route cards (phase 4) are made from these.

Rules: an approved order can be *reopened* for changes (all approvals again) while nothing is sent to production;
cancelling an order cancels its open requests; a draft that was never sent can be deleted.

## Route cards → material → stages → FG stock (phase 4)

1. **Route card** (Production): *Production requests* → **Make route card**. Choose the raw material (grade / bar size),
   bar weight per piece and extra pieces; the card shows how many kg are needed. All 16 stages are ticked; untick the
   ones this part does not go through (the next card of the same part starts with the same stages).
   *Print* gives the paper route card for the shop floor.
2. **Material**: Production clicks *Ask store for material*. The store (*Material issue*) issues it **heat by heat**
   (*Fill oldest first*), or raises a purchase requisition when stock is short. Leftover bar goes back with *Return to store*.
3. **Stages**, in order, each recorded only by its department (roles set in *Masters → Process Stages*; no role = admin only):
   - material checks (chemical test, RM inspection, UT): **OK / Not OK** for the issued heats; Not OK holds the card;
   - piece stages: **OK + rejected = pieces received** from the stage before; a reason is needed for rejections;
   - weight stages (cutting, forging, machining): weight per piece, scrap per piece is worked out;
   - chemical and mechanical testing need the **report attached** before they can be saved.
   A stage can be changed or cleared until the next stage is recorded. *Route cards → Waiting for me* lists the cards at
   your department's stages.
4. **Finished parts in** (Store): after the last stage a completion slip (`RCC/26-27/0001`) is made. The store puts the OK
   pieces into the **FG store under the heats** they were made from. The card is then *In FG stock* and its production
   request *Made*.

A card can be cancelled only before any stage is recorded and after its material is returned; its request can then be planned again.

## Job work: parts made by vendors (phase 5)

1. **Job work order** (Production): products marked *Outsource* at feasibility show a stock check with *With vendor*;
   **Make job work order** fills in the parts still short. Choose the vendor, the charge per piece and our raw material
   to send. Orders for stock are made from *Job Work Orders → New*. *Print challan* gives the job work order + delivery
   challan for the vendor (parts, our material with our and mill heat numbers, GST job-work note).
2. **Material to the vendor** (Store): *Material issue → For job work* → *Send*, heat by heat (oldest first). The material
   then shows in stock as *JOB_WORK* (with the vendor) until the order is finished; unused bar comes back with *Back from vendor*.
3. **Job-work PO** (Accounts): *Make job-work PO* on the order makes a draft PO of type *Job work* with the parts and
   rates; approve, print and e-mail it like any PO. It follows what QC accepts (part received / received).
   Gate entry only offers material POs.
4. **Receive parts** (QC / Store): received, accepted and rejected pieces (reason needed) per part, and the heat.
   Accepted pieces go into the **FG store under that heat**; rejected ones stay pending with the vendor.
   When everything is accepted the order is *Completed* and the material at the vendor is booked as used.
   *Close short* ends an order early; *Cancel* only before anything is received and after the material is back.

## Packing → invoice → dispatch → payments (phase 6)

1. **Pack sets** (Dispatch): on an approved sales order, *Packing, invoices & dispatch* → **Pack sets**. The screen proposes
   the sets that can be made from FG stock and, per part, the heats (oldest first); the split can be changed. Packing takes
   the parts out of the FG store and remembers which heat went into which set. *Unpack* puts them back (before invoicing).
2. **Invoice** (Accounts): on the packing, **Make invoice** makes a draft with the customer, prices, currency and GST
   (CGST+SGST in Gujarat, IGST outside, export without GST under LUT). Check it, choose the billing company if needed,
   then **Issue invoice**: it gets the next number of *that company's* series (`DEMO/26-27/001`,
   export `DEMO/EXP/26-27/001`; format in *Admin → Number Series*, `{CO}` = company code). PDF and e-mail from the invoice.
   An issued invoice is never edited; it can be cancelled (number stays used) while nothing is dispatched or paid.
3. **Dispatch** (Dispatch): on the issued invoice, **Dispatch** with transporter, LR, vehicle, driver, packages and weight.
   The sales order becomes *Part dispatched* / *Dispatched*. The **packing list** PDF lists every part with its heat number.
4. **Payments** (Accounts): *Payments → Customers owe us / We owe suppliers* shows open invoices and POs with balance and days
   overdue; **Received** / **Paid** records the money (amount, mode, UTR / cheque). A wrong entry is cancelled, not deleted.
   The dispatch date cannot be before the invoice date.

## Traceability and reports (phase 7)

Menu **Reports**. Every report has a period (this month, last month, quarter, financial year April–March, or any dates),
filters, and an **Excel (CSV)** download for users with the *export* permission.

| Screen | What it answers | Permission |
|---|---|---|
| **Traceability** | One search box: heat no., mill heat, SO, customer PO, invoice or dispatch no. **Heat view**: gate entry + incoming QC → route cards / job work (kg) → finished parts (made on which card) → packings → invoice, dispatch → customers. **Order view**: every packed part with its heat, mill heat, material, gate entry, QC and MTC, plus route cards with the tests passed. PDFs: *heat report* (internal QA) and *material traceability* (for the customer — no supplier / vendor names). Also from the heat list (⋯ → Trace this heat), a sales order and an invoice. | `traceability` |
| **Stock Movement** | Opening, in, out, closing per raw material (kg) or part (pcs) for a period; one location or all; per heat | `reports` |
| **Production & Rejections** | Finished OK pieces, rejections by stage / reason / part, rejection rate, job work by vendor | `reports` |
| **Pending Orders** | Approved orders with sets still to dispatch: packed, dispatched, due date, days late, value | `reports` |
| **Sales & GST** | GST sales register (CGST / SGST / IGST, export), by customer, by product, by month with money received | `business_reports` |
| **Purchases** | PO register (material + job work) and by supplier, with paid / balance | `business_reports` |
| **Ageing** | What customers owe us and we owe suppliers, split 0 / 1–30 / 31–60 / 61–90 / 90+ days late | `business_reports` |

Amounts are in rupees; USD invoices count at their own exchange rate. The dashboard shows a **Money** section (sales
this month / year, to receive, to pay, a 12-month sales vs money-received chart, top customers) to users with
`business_reports.view` (Accounts, MR). Anyone allowed to trace can open the MTC and test-report files listed in a trace.

## HR & payroll (phase 8)

Menu **HR & Payroll**. The **HR** role has all of it; Accounts can see payroll and loans; MR can see employees,
attendance and assets.

1. **Employees**: the employee code must be the **user number on the biometric machine** (punches are matched by it).
   Basic salary per month, shift hours, PF yes / no + UAN, bank account (for the bank transfer sheet; none = cash).
   Someone who leaves is marked *Left* with a date; a person with attendance, leave, loans or payslips cannot be deleted.
2. **Attendance**: punches come in pairs, **IN / OUT / IN / OUT**; hours are worked out from the pairs, an odd punch is a
   *missing punch*. **Sunday is the weekly off** (work on Sunday is shown, not counted as a day). Three ways in:
   - **Machine push**: eSSL / ZKTeco machines with *ADMS* (*Comm. → Cloud Server Setting*): server = the ERP address and
     port. The machine appears in *Attendance → Machines* as *waiting*; **approve** it and its punches flow in by themselves.
   - **Import CSV** from the machine software (code, name, date, punch times …): a preview shows what is ready, unknown
     codes and closed months before anything is saved. Punches already in the ERP are never added twice.
   - **Correct a day** by clicking it (forgot to punch out, machine down) with a reason; it shows as *Manual*.
   Punches from codes that are not employees are kept aside and counted as soon as an employee with that code is added.
3. **Leaves**: CL, SL, EL are paid and come from the **yearly allowance** (*Balances → Change*, or for everyone);
   LWP is unpaid. Sundays are not counted. HR can approve at once or leave it *Waiting* for approval.
4. **Loans & advances**: amount, monthly **EMI** and the first salary month it is taken from. Paused loans are skipped.
   Money paid back in cash / bank is recorded on the loan; the ledger shows every EMI with its salary month.
5. **Payroll** (once a month, for the month just ended):
   - **Prepare** makes a draft for everyone with attendance. Per employee:
     **day rate = basic ÷ month days (setting, 25 as in the old ERP)**; days paid = present days + paid leave (at most the
     month days); **hours** above / below *present days × shift hours* are added / cut at day rate ÷ shift hours;
     **PF** = 12% of basic for the days paid (if PF is ticked); then the **loan EMIs**; net is rounded to the rupee.
     ESI and professional tax are not deducted (same as the old ERP).
   - Change attendance / leave and **Recalculate**, or add / cut an amount for one person (bonus, fine) with a note.
   - **Finalize**: EMIs are taken off the loans and the month's attendance is **closed** (no more changes).
     **Revoke** undoes that while it is not paid. **Mark salaries paid** (date, bank batch) ends it.
   - Payslips PDF (two per A4 page, net in words, loan balance), salary register and **bank transfer sheet** (CSV).
6. **Assets & safety**: company assets and who has them (shown on the employee page); safety equipment (fire
   extinguishers, cranes …) with *Record inspection*, which sets the next due date from the interval.

The dashboard shows HR's to-dos: leave to approve, missing punches of the last 7 days, unknown codes, machines waiting,
safety checks due in 15 days, last month's payroll to prepare and drafts to finalize.

## Ask ERP: questions in plain words (phase 9)

The **Ask ERP** button in the top bar opens a chat panel. Staff type a question - in English, with Gujarati / Hindi
words if they like (*aaje kon gerhajar che?*) - and get the answer from the ERP data, with the numbers, a short table
and a button to open the screen. It runs **entirely inside the ERP**: no outside AI service, no cost per question,
no data leaves the server. The code is in `apps/api/src/assistant` (question reading in `language.ts`, names in
`catalog.ts`, one file of topics per area in `topics/`).

| Area | For example | Needs |
|---|---|---|
| Stock | *stock of 4130 90 mm round*, *stock of RM-0007*, *stock of 2 inch fig 1502 male*, *which material is below reorder level?* | `stock.view` |
| Sales | *status of SO/26-27/0003*, *where is so 3?*, *open orders of Alpha*, *pending / late orders* | `sales_orders.view`, `reports.view` |
| Production | *rc 2 status*, *route cards at forging*, *rejections this month* | `route_cards.view`, `reports.view` |
| Purchase | *status of po 2*, *open purchase orders* | `purchase_orders.view` |
| Quality | *trace heat A102602* | `traceability.view` |
| Money | *sales last month*, *who owes us money?*, *how much do we owe suppliers?*, *is invoice 12 paid?* | `business_reports.view`, `payments.view`, `invoices.view` |
| HR | *who is absent today?*, *attendance of 105 this month*, *leave balance of 102*, *loan of 106*, *salary of 101 last month*, *details of 105*, *safety checks due*, *who has LAP-01?* | the HR module of each |

- **Permissions:** the menu permission *Ask ERP* (given to every role) opens the panel; each answer also needs the
  permission of the screen it comes from, so a Store user cannot ask about salaries. Bank numbers are masked.
- **Dates:** today, yesterday, this / last week, this / last month, a month name (*september*, *sep 2025*), a date
  (*21 oct*, *21/10/2026*), *this year* (financial year), *fy 2025-26*, *last 7 days*.
- **Follow-ups:** *and last month?* or *what about 102?* keep the previous topic.
- **Spelling:** small mistakes are understood (*atendance*, *pendng orders*, *salry*) and the answer says how the word
  was read; names of customers, employees and parts are never changed. More everyday words: *kitne log aaye*,
  *nathi aavya*, *baki*, *gaya mahine*.
- **Answers** come as a card: title, summary, key figures, a table, buttons to open the screen, *Copy*, and related questions.
- Questions it cannot place get a polite "did not understand" with example questions; they are written to the API
  log (`Not understood: ...`), which shows what to add next.

## Live screens, chat and notifications (phase 10)

Everything here runs inside the ERP over one live connection per open screen (`/api/events`, server-sent events) -
no outside service.

- **Live screens:** when anyone saves ERP data, every open screen reloads what it shows within a second (for example a
  stage recorded by Forging appears on the Admin's open route card). Coming back to the tab also refreshes.
- **Chat** (top-bar icon with the unread count, or menu *Chat*): one-to-one chats and groups (the maker is admin:
  rename, add / remove people; anyone can leave). Messages arrive at once; a pop-up shows when the chat is not open;
  ✓ = sent, ✓✓ = seen; online dot; own messages can be deleted; older messages load on request.
- **Bell** (top bar): the ERP tells the people who must act when work reaches them:

  | When | Who is told |
  |---|---|
  | Sales order sent for approval / feasibility approved | feasibility approvers / design and production approvers |
  | Sales order fully approved or rejected | production planning (approved) and the sales person |
  | Production requested from an order | who make route cards |
  | Purchase requisition raised / draft PO made / gate entry made | who order (Accounts) / PO approvers / incoming QC |
  | Material requested for a route card; job work order made | the store (material to issue / to send to the vendor) |
  | Route card moves to a stage; route card finished | the roles of that stage; the store (put in FG store) |
  | Packing done; invoice issued | who invoice; dispatch |
  | Leave waiting; payroll prepared; new biometric machine | leave approvers; payroll approvers; attendance approvers |

  The person who did it is not told, Admin is not flooded with every task, and the same unread task is not sent twice.
- **Send notice** (bell, permission *Send notices to staff* - HR, MR and Admin): title, message, optional screen to
  open, to everyone / chosen roles / chosen people.
- **Desktop alerts:** a switch in the bell turns on Windows pop-ups for chats and notices when the ERP tab is in the
  background (the browser asks once; it works on `https://` addresses and on `localhost`).
- Permissions: *Chat with colleagues* (every role) and *Send notices to staff* in *Admin → Roles & Permissions*.
  The live connection runs in the API process memory: fine for one API server.

## Sample data (DEMO LTD)

The database `erpforsell` holds a complete sample run with made-up names only: suppliers (Omega Alloy Steels, Sigma Steel
Traders, job worker Kappa Machining Works), customers in Gujarat (Alpha Oilfield Services, Delta Wellhead Solutions),
Maharashtra (Beta Drilling Equipment, IGST) and Dubai (Gamma Petroleum Equipment, export, USD), purchase → gate entry →
heats, 4 sales orders, route cards with weights / rejections / reports, a job work order, packing, invoices
(`DEMO/26-27/001`, `DEMO/26-27/002`, `DEMO/EXP/26-27/001`), dispatches with packing lists and payments.
HR: 9 employees (codes 101–109) with attendance, leave, a finalized payroll, loans, assets and safety equipment.
All phone numbers, e-mails (example.com), GSTINs, bank and UAN numbers are sample values.
Sign in as `admin` / `Admin@12345`, or as a department user with password `Demo@1234`: neha (Sales), ramesh (Production),
amit (Design), kiran (Store), vijay (QC), bhavesh (Forging), priya (Accounts), hitesh (Dispatch), meena (HR).

`apps/api/prisma/sample-data/demo-ltd-sample.sql` is the script that turned the sample run into DEMO LTD.

## A new client

1. Create an empty database for the client, run `pnpm --filter @bht/api db:deploy` and `pnpm db:seed` (it creates the
   sample company DEMO LTD, the roles, the 16 route-card stages and the number formats).
2. Sign in as admin, change the password, then in *Admin → Companies* put the client's name, address, GSTIN, PAN and bank,
   and in *Admin → Number Series* / *Masters → Process Stages* adjust what differs.
3. Before building the web app set the client's screen name: `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_BRAND_SHORT`,
   `NEXT_PUBLIC_BRAND_FOOTER`, `NEXT_PUBLIC_BRAND_ADDRESS` (and `NEXT_PUBLIC_PRODUCT_NAME` if the software gets its own
   name); for the API `BRAND_NAME`, `BRAND_SHORT` and `MAIL_FROM`.

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | run API + web with auto-reload |
| `pnpm build` | production build of everything |
| `pnpm typecheck` | type-check all packages |
| `pnpm db:migrate` | after changing `schema.prisma`: create + apply a migration |
| `pnpm db:studio` | browse the database in the browser |
| `pnpm db:reset` | **wipes** the dev database, re-creates it and seeds it |

## How it is built (rules to keep)

- **One validation rule, two places.** Form rules live in `packages/shared/src/schemas`.
  The web form and the API use the same zod schema.
- **Every endpoint is protected.** The global `AuthGuard` checks the login cookie, re-reads
  the user from the database (a disabled user is out immediately) and checks
  `@RequirePermission('module.action')`. Only `@Public()` endpoints skip it.
- **Permissions** are listed once in `packages/shared/src/permissions.ts`. Add a module there,
  then tick it for roles in *Admin → Roles & Permissions*.
- **Stock only changes through `StockService.post()`**, which writes the ledger and the
  balance in one transaction and refuses to go below zero.
- **Document numbers** come from `NumberingService.next()` (atomic, no duplicates, format set in
  *Admin → Number Series*).
- **Every change is audited** (who, when, before → after) — *Admin → Audit Log*.

## Production (outline)

Node apps need a **VPS** (e.g. Hostinger KVM 2, Ubuntu), not shared hosting:

1. MySQL 8 (or MariaDB 11) on the VPS, a database + user just for the ERP, daily `mysqldump` backup.
2. `pnpm install && pnpm build`, then `pnpm --filter @bht/api db:deploy` to apply migrations.
3. Run `node apps/api/dist/main.js` and the web app with **pm2** or systemd. Set `TZ=Asia/Kolkata`.
4. **Caddy** or nginx in front with HTTPS: `erp.client-domain.com` → web :3500 (the web app forwards `/api` to the API).
5. In `apps/api/.env`: `NODE_ENV=production`, a long random `JWT_ACCESS_SECRET`, the real `DATABASE_URL`.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: login, roles, users, companies, number series, audit, all masters, clean DB, data import | **done** |
| 2 | Purchase requisition → PO (PDF/email) → gate entry + incoming QC → RM stock by heat | **done** |
| 3 | Sales orders, approvals (feasibility / design / production), stock check, make-to-stock | **done** |
| 4 | Route cards, material issue by heat, 16 stages, rejections, completion → FG stock | **done** |
| 5 | Job work / outsource orders, receipt + QC | **done** |
| 6 | Assembly & packing, GST invoices (INR/USD), dispatch, payments | **done** |
| 7 | Heat & order traceability (+ PDFs), stock movement, production & rejections, pending orders, sales / GST, purchases, ageing, money dashboard | **done** |
| 8 | HR & payroll: employees, biometric attendance (machine push + CSV), leave, loans, payroll + payslips, assets & safety | **done** |
| 9 | Ask ERP: questions in plain words (English + Gujarati words) answered from the ERP data, with permissions | **done** |
| 10 | Live screens, internal chat (direct + groups), bell notifications for every hand-off, notices, desktop alerts | **done** |
