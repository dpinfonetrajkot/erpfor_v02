import { Injectable } from '@nestjs/common';
import { hasPermission } from '@bht/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/auth-user';

export interface SearchHit {
  type: string;
  id: number;
  title: string;
  subtitle: string;
  href: string;
}

const TAKE = 5;

/**
 * "Search everything" (Ctrl+K and Ask ERP): records whose number, code or name contains the text.
 * Each kind of record is searched only when the user may open its screen.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(user: AuthUser, raw?: string): Promise<SearchHit[]> {
    const q = (raw ?? '').trim().slice(0, 60);
    if (q.length < 2) return [];
    const can = (perm: string) => hasPermission(user.permissions, perm);
    const has = { contains: q };
    const enc = encodeURIComponent;

    const jobs: Promise<SearchHit[]>[] = [];

    if (can('sales_orders.view'))
      jobs.push(
        this.prisma.salesOrder
          .findMany({
            where: { OR: [{ soNo: has }, { customerPoNo: has }, { customer: { name: has } }] },
            take: TAKE,
            orderBy: { id: 'desc' },
            select: { id: true, soNo: true, status: true, customerPoNo: true, customer: { select: { name: true } } },
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'Sales order',
              id: r.id,
              title: r.soNo,
              subtitle: [r.customer.name, r.customerPoNo && `PO ${r.customerPoNo}`, words(r.status)].filter(Boolean).join(' · '),
              href: `/sales/orders/${r.id}`,
            })),
          ),
      );

    if (can('invoices.view'))
      jobs.push(
        this.prisma.invoice
          .findMany({
            where: { OR: [{ invoiceNo: has }, { customerPoNo: has }, { customer: { name: has } }] },
            take: TAKE,
            orderBy: { id: 'desc' },
            select: { id: true, invoiceNo: true, status: true, currency: true, grandTotal: true, customer: { select: { name: true } } },
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'Invoice',
              id: r.id,
              title: r.invoiceNo,
              subtitle: `${r.customer.name} · ${r.currency} ${Number(r.grandTotal).toLocaleString('en-IN')} · ${words(r.status)}`,
              href: `/billing/invoices/${r.id}`,
            })),
          ),
      );

    if (can('purchase_orders.view'))
      jobs.push(
        this.prisma.purchaseOrder
          .findMany({
            where: { OR: [{ poNo: has }, { supplier: { name: has } }] },
            take: TAKE,
            orderBy: { id: 'desc' },
            select: { id: true, poNo: true, status: true, supplier: { select: { name: true } } },
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'Purchase order',
              id: r.id,
              title: r.poNo,
              subtitle: `${r.supplier.name} · ${words(r.status)}`,
              href: `/purchase/orders/${r.id}`,
            })),
          ),
      );

    if (can('route_cards.view'))
      jobs.push(
        this.prisma.routeCard
          .findMany({
            where: { OR: [{ rcNo: has }, { item: { name: has } }, { item: { code: has } }] },
            take: TAKE,
            orderBy: { id: 'desc' },
            select: { id: true, rcNo: true, status: true, item: { select: { name: true } }, currentStage: { select: { name: true } } },
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'Route card',
              id: r.id,
              title: r.rcNo,
              subtitle: [r.item.name, r.currentStage?.name ?? words(r.status)].join(' · '),
              href: `/production/route-cards/${r.id}`,
            })),
          ),
      );

    if (can('job_work_orders.view'))
      jobs.push(
        this.prisma.jobWorkOrder
          .findMany({
            where: { OR: [{ jwoNo: has }, { supplier: { name: has } }] },
            take: TAKE,
            orderBy: { id: 'desc' },
            select: { id: true, jwoNo: true, status: true, supplier: { select: { name: true } } },
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'Job work order',
              id: r.id,
              title: r.jwoNo,
              subtitle: `${r.supplier.name} · ${words(r.status)}`,
              href: `/job-work/orders/${r.id}`,
            })),
          ),
      );

    if (can('heats.view') || can('traceability.view'))
      jobs.push(
        this.prisma.heat
          .findMany({
            where: { OR: [{ heatNo: has }, { millHeatNo: has }] },
            take: TAKE,
            orderBy: { id: 'desc' },
            select: { id: true, heatNo: true, millHeatNo: true, status: true },
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'Heat',
              id: r.id,
              title: r.heatNo,
              subtitle: [r.millHeatNo && `Mill heat ${r.millHeatNo}`, words(r.status)].filter(Boolean).join(' · '),
              href: can('traceability.view') ? `/reports/traceability/heat/${r.id}` : `/masters/heats?search=${enc(r.heatNo)}`,
            })),
          ),
      );

    if (can('customers.view'))
      jobs.push(
        this.prisma.customer
          .findMany({
            where: { OR: [{ code: has }, { name: has }, { gstin: has }, { city: has }] },
            take: TAKE,
            orderBy: { name: 'asc' },
            select: { id: true, code: true, name: true, city: true },
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'Customer',
              id: r.id,
              title: r.name,
              subtitle: [r.code, r.city].filter(Boolean).join(' · '),
              href: `/masters/customers?search=${enc(r.code)}`,
            })),
          ),
      );

    if (can('suppliers.view'))
      jobs.push(
        this.prisma.supplier
          .findMany({
            where: { OR: [{ code: has }, { name: has }, { gstin: has }, { city: has }] },
            take: TAKE,
            orderBy: { name: 'asc' },
            select: { id: true, code: true, name: true, city: true },
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'Supplier',
              id: r.id,
              title: r.name,
              subtitle: [r.code, r.city].filter(Boolean).join(' · '),
              href: `/masters/suppliers?search=${enc(r.code)}`,
            })),
          ),
      );

    if (can('items.view'))
      jobs.push(
        this.prisma.item
          .findMany({
            where: { OR: [{ code: has }, { name: has }] },
            take: TAKE,
            orderBy: { name: 'asc' },
            select: { id: true, code: true, name: true },
          })
          .then((rows) => rows.map((r) => ({ type: 'Part', id: r.id, title: r.name, subtitle: r.code, href: `/masters/items?search=${enc(r.code)}` }))),
      );

    if (can('products.view'))
      jobs.push(
        this.prisma.product
          .findMany({
            where: { OR: [{ code: has }, { name: has }] },
            take: TAKE,
            orderBy: { name: 'asc' },
            select: { id: true, code: true, name: true },
          })
          .then((rows) => rows.map((r) => ({ type: 'Product', id: r.id, title: r.name, subtitle: r.code, href: `/masters/products?search=${enc(r.code)}` }))),
      );

    if (can('employees.view'))
      jobs.push(
        this.prisma.employee
          .findMany({
            where: { OR: [{ empCode: has }, { name: has }] },
            take: TAKE,
            orderBy: { name: 'asc' },
            select: { id: true, empCode: true, name: true, designation: true },
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'Employee',
              id: r.id,
              title: r.name,
              subtitle: [`Code ${r.empCode}`, r.designation].filter(Boolean).join(' · '),
              href: `/hr/employees/${r.id}`,
            })),
          ),
      );

    const hits = (await Promise.all(jobs)).flat();
    // exact number / code matches first, then names that start with the text
    const lower = q.toLowerCase();
    const rank = (h: SearchHit) => (h.title.toLowerCase() === lower ? 0 : h.title.toLowerCase().startsWith(lower) ? 1 : 2);
    return hits.map((h, i) => ({ h, i })).sort((a, b) => rank(a.h) - rank(b.h) || a.i - b.i).map(({ h }) => h).slice(0, 30);
  }
}

function words(status: string) {
  const s = status.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
