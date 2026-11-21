import { BadRequestException, Injectable } from '@nestjs/common';
import type { ListQuery, PaymentInput } from '@bht/shared';
import { AuditAction, InvoiceStatus, PaymentDirection, PaymentStatus, Prisma, PurchaseOrderStatus } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { listArgs, paginated } from '../common/list';
import type { Actor } from '../common/auth-user';
import { InvoicesService } from './invoices.service';

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/** POs that can be paid: issued and later (not drafts / cancelled). */
export const PAYABLE_PO: PurchaseOrderStatus[] = [PurchaseOrderStatus.ISSUED, PurchaseOrderStatus.PARTIALLY_RECEIVED, PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.CLOSED];

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(query: ListQuery, filters: { direction?: PaymentDirection; invoiceId?: number; purchaseOrderId?: number }) {
    const args = listArgs(
      query,
      {
        searchFields: ['paymentNo', 'reference', 'remarks', 'customer.name', 'supplier.name', 'invoice.invoiceNo', 'purchaseOrder.poNo'],
        sortable: ['paymentNo', 'paymentDate', 'amount'],
        defaultSort: { field: 'id', dir: 'desc' },
      },
      {
        ...(filters.direction ? { direction: filters.direction } : {}),
        ...(filters.invoiceId ? { invoiceId: filters.invoiceId } : {}),
        ...(filters.purchaseOrderId ? { purchaseOrderId: filters.purchaseOrderId } : {}),
      },
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        ...args,
        include: {
          customer: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          invoice: { select: { id: true, invoiceNo: true, currency: true } },
          purchaseOrder: { select: { id: true, poNo: true, currency: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.payment.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  /** Who still owes us (issued invoices) or whom we still owe (POs), with the balance and days overdue. */
  async outstanding(direction: PaymentDirection) {
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
    if (direction === PaymentDirection.RECEIPT) {
      const rows = await this.prisma.invoice.findMany({
        where: { status: InvoiceStatus.ISSUED, paymentStatus: { not: PaymentStatus.PAID } },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        select: { id: true, invoiceNo: true, invoiceDate: true, dueDate: true, currency: true, exchangeRate: true, grandTotal: true, amountPaid: true, customer: { select: { id: true, name: true } } },
      });
      return rows.map((r) => ({
        kind: 'invoice' as const,
        id: r.id,
        number: r.invoiceNo,
        date: r.invoiceDate,
        dueDate: r.dueDate,
        party: r.customer,
        currency: r.currency,
        exchangeRate: num(r.exchangeRate),
        total: num(r.grandTotal),
        paid: num(r.amountPaid),
        balance: r2(num(r.grandTotal) - num(r.amountPaid)),
        overdueDays: r.dueDate && r.dueDate.getTime() < today ? Math.round((today - r.dueDate.getTime()) / 86_400_000) : 0,
      }));
    }
    const rows = await this.prisma.purchaseOrder.findMany({
      where: { status: { in: PAYABLE_PO }, paymentStatus: { not: PaymentStatus.PAID } },
      orderBy: [{ poDate: 'asc' }, { id: 'asc' }],
      select: { id: true, poNo: true, poDate: true, type: true, currency: true, grandTotal: true, paidAmount: true, supplier: { select: { id: true, name: true, paymentTermsDays: true } } },
    });
    return rows.map((r) => {
      const due = r.supplier.paymentTermsDays ? new Date(r.poDate.getTime() + r.supplier.paymentTermsDays * 86_400_000) : null;
      return {
        kind: 'purchase_order' as const,
        id: r.id,
        number: r.poNo,
        type: r.type,
        date: r.poDate,
        dueDate: due,
        party: { id: r.supplier.id, name: r.supplier.name },
        currency: r.currency,
        exchangeRate: 1,
        total: num(r.grandTotal),
        paid: num(r.paidAmount),
        balance: r2(num(r.grandTotal) - num(r.paidAmount)),
        overdueDays: due && due.getTime() < today ? Math.round((today - due.getTime()) / 86_400_000) : 0,
      };
    });
  }

  async create(input: PaymentInput, actor: Actor) {
    const p = await this.prisma.$transaction(async (tx) => {
      const paymentDate = new Date(`${input.paymentDate}T00:00:00Z`);
      let party: { customerId?: number; supplierId?: number };
      let label: string;
      if (input.direction === 'RECEIPT') {
        const inv = await tx.invoice.findUniqueOrThrow({ where: { id: input.invoiceId! } });
        if (inv.status !== InvoiceStatus.ISSUED) throw new BadRequestException('Payments can only be received on an issued invoice');
        const balance = r2(num(inv.grandTotal) - num(inv.amountPaid));
        if (input.amount > balance + 0.005) throw new BadRequestException({ message: `Only ${balance} ${inv.currency} is still due on ${inv.invoiceNo}`, errors: { amount: `Max ${balance}` } });
        party = { customerId: inv.customerId };
        label = `${input.amount} ${inv.currency} received on ${inv.invoiceNo}`;
      } else {
        const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: input.purchaseOrderId! } });
        if (!PAYABLE_PO.includes(po.status)) throw new BadRequestException('Only an approved purchase order can be paid');
        const balance = r2(num(po.grandTotal) - num(po.paidAmount));
        if (input.amount > balance + 0.005) throw new BadRequestException({ message: `Only ${balance} ${po.currency} is still to pay on ${po.poNo}`, errors: { amount: `Max ${balance}` } });
        party = { supplierId: po.supplierId };
        label = `${input.amount} ${po.currency} paid on ${po.poNo}`;
      }
      const created = await tx.payment.create({
        data: {
          paymentNo: await this.numbering.next('PAYMENT', { tx, date: paymentDate }),
          paymentDate,
          direction: input.direction,
          ...party,
          invoiceId: input.direction === 'RECEIPT' ? input.invoiceId! : null,
          purchaseOrderId: input.direction === 'PAYMENT' ? input.purchaseOrderId! : null,
          amount: input.amount,
          mode: input.mode,
          reference: input.reference || null,
          remarks: input.remarks || null,
          createdById: actor.userId,
        },
      });
      await this.refresh(tx, created);
      await this.audit.log(actor, { action: AuditAction.CREATE, entity: 'payment', entityId: created.id, summary: `${created.paymentNo}: ${label}` }, tx);
      return created;
    });
    return { id: p.id, paymentNo: p.paymentNo };
  }

  /** Wrong entry: the payment stays on record as cancelled and the balance is open again. */
  async cancel(id: number, reason: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (p.cancelledAt) throw new BadRequestException(`${p.paymentNo} is already cancelled`);
      await tx.payment.update({ where: { id }, data: { cancelledAt: new Date(), cancelReason: reason } });
      await this.refresh(tx, p);
      await this.audit.log(actor, { action: AuditAction.STATUS_CHANGE, entity: 'payment', entityId: id, summary: `Cancelled ${p.paymentNo}: ${reason}` }, tx);
    });
  }

  private async refresh(tx: Tx, p: { invoiceId: number | null; purchaseOrderId: number | null }) {
    if (p.invoiceId) await InvoicesService.refreshPaid(tx, p.invoiceId);
    if (p.purchaseOrderId) {
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: p.purchaseOrderId }, include: { payments: { where: { cancelledAt: null } } } });
      const paid = r2(po.payments.reduce((s, x) => s + num(x.amount), 0));
      const status = paid <= 0 ? PaymentStatus.UNPAID : paid + 0.005 >= num(po.grandTotal) ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { paidAmount: paid, paymentStatus: status } });
    }
  }
}
