import { Injectable } from '@nestjs/common';
import { hasPermission } from '@bht/shared';
import { ApprovalStage } from '../generated/prisma/client';
import { awaitingWhere } from '../sales/sales-orders.service';
import { waitingForWhere } from '../production/route-cards.service';
import { RUNNING } from '../jobwork/job-work.service';
import { PACKABLE } from '../billing/assemblies.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/auth-user';

/**
 * "Work waiting for you": how many records wait in each work list the user can act on
 * (null = not the user's work). Used by the dashboard and by Ask ERP.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async tasks(user: AuthUser) {
    const can = (perm: string) => hasPermission(user.permissions, perm);
    const count = (where: Parameters<PrismaService['salesOrder']['count']>[0]) => this.prisma.salesOrder.count(where);
    const [soFeasibility, soDesign, soProduction, soToPlan, productionRequests] = await Promise.all([
      can('so_feasibility.approve') ? count({ where: awaitingWhere(ApprovalStage.FEASIBILITY) }) : null,
      can('so_design.approve') ? count({ where: awaitingWhere(ApprovalStage.DESIGN) }) : null,
      can('so_production.approve') ? count({ where: awaitingWhere(ApprovalStage.PRODUCTION) }) : null,
      can('stock_check.create') ? count({ where: { status: 'APPROVED' } }) : null,
      can('route_cards.view') || can('stock_check.view') ? this.prisma.productionRequest.count({ where: { status: 'REQUESTED' } }) : null,
    ]);
    const [rcAtMyStages, mrToIssue, completionsToMove] = await Promise.all([
      can('route_card_operations.update') ? this.prisma.routeCard.count({ where: waitingForWhere(user) }) : null,
      can('material_issues.issue') ? this.prisma.materialRequisition.count({ where: { status: { in: ['PENDING', 'PARTIAL'] } } }) : null,
      can('rc_completions.create') ? this.prisma.rcCompletion.count({ where: { status: 'PENDING' } }) : null,
    ]);
    const [jwToPlan, jwMaterialToSend, jwToReceive] = await Promise.all([
      // outsourced products of approved orders without a job work order yet
      can('job_work_orders.create')
        ? this.prisma.salesOrderLine.count({
            where: {
              decision: 'OUTSOURCE',
              salesOrder: { status: { in: ['APPROVED', 'IN_PRODUCTION'] } },
              jobWorkLines: { none: { jobWorkOrder: { status: { not: 'CANCELLED' } } } },
            },
          })
        : null,
      can('material_issues.issue')
        ? this.prisma.jobWorkMaterial.count({ where: { status: { in: ['PENDING', 'PARTIAL'] }, jobWorkOrder: { status: { in: RUNNING } } } })
        : null,
      can('job_work_receipts.create') ? this.prisma.jobWorkOrder.count({ where: { status: { in: RUNNING } } }) : null,
    ]);
    const todayDate = new Date(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10) + 'T00:00:00Z');
    const [toPack, toInvoice, invoicesToIssue, toDispatch, overdueInvoices] = await Promise.all([
      can('assemblies.create') ? this.ordersToPack() : null,
      can('invoices.create') ? this.prisma.assembly.count({ where: { status: 'PACKED', invoices: { none: { status: { not: 'CANCELLED' } } } } }) : null,
      can('invoices.approve') ? this.prisma.invoice.count({ where: { status: 'DRAFT' } }) : null,
      can('dispatches.create')
        ? this.prisma.invoice.count({ where: { status: 'ISSUED', salesOrderId: { not: null }, dispatches: { none: { cancelledAt: null } } } })
        : null,
      can('payments.view') ? this.prisma.invoice.count({ where: { status: 'ISSUED', paymentStatus: { not: 'PAID' }, dueDate: { lt: todayDate } } }) : null,
    ]);
    const [prPending, poToApprove, poOpen, grnPendingQc] = await Promise.all([
      can('purchase_requisitions.view') || can('purchase_orders.create') ? this.prisma.purchaseRequisition.count({ where: { status: 'PENDING' } }) : null,
      can('purchase_orders.approve') ? this.prisma.purchaseOrder.count({ where: { status: 'DRAFT' } }) : null,
      can('purchase_orders.view') || can('goods_receipts.create') ? this.prisma.purchaseOrder.count({ where: { status: { in: ['ISSUED', 'PARTIALLY_RECEIVED'] } } }) : null,
      can('incoming_qc.update') || can('goods_receipts.view') ? this.prisma.goodsReceipt.count({ where: { status: 'PENDING_QC' } }) : null,
    ]);
    const hr = await this.hrTasks(can);
    return {
      prPending,
      poToApprove,
      poOpen,
      grnPendingQc,
      soFeasibility,
      soDesign,
      soProduction,
      soToPlan,
      productionRequests,
      rcAtMyStages,
      mrToIssue,
      completionsToMove,
      jwToPlan,
      jwMaterialToSend,
      jwToReceive,
      toPack,
      toInvoice,
      invoicesToIssue,
      toDispatch,
      overdueInvoices,
      ...hr,
    };
  }

  /** HR to-dos: leave to approve, punches to fix, machines and codes to sort out, safety checks, payroll. */
  private async hrTasks(can: (perm: string) => boolean) {
    const today = new Date(Date.now() + 330 * 60_000);
    const day = (offset: number) => new Date(`${new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`);
    const lastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const [leavesToApprove, recentDays, unknownCodes, devicesWaiting, safetyDue, lastRun, draftPayrolls] = await Promise.all([
      can('leaves.approve') ? this.prisma.leaveRequest.count({ where: { status: 'PENDING' } }) : null,
      can('attendance.update') ? this.prisma.attendance.findMany({ where: { date: { gte: day(-7), lt: day(0) } }, select: { punches: true } }) : null,
      can('attendance.view') ? this.prisma.attendancePunch.groupBy({ by: ['empCode'], where: { employeeId: null } }).then((g) => g.length) : null,
      can('attendance.approve') ? this.prisma.biometricDevice.count({ where: { isApproved: false } }) : null,
      can('assets.view') ? this.prisma.safetyAsset.count({ where: { OR: [{ nextDueDate: { lte: day(15) } }, { status: { not: 'OK' } }] } }) : null,
      can('payroll.create')
        ? this.prisma.payrollRun.findUnique({ where: { month: lastMonth } }).then(async (run) => {
            if (run) return run;
            const from = new Date(`${lastMonth}-01T00:00:00Z`);
            const worked = await this.prisma.attendance.count({ where: { date: { gte: from, lt: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)) } } });
            return worked ? null : { id: 0 }; // nothing to pay: nothing to prepare
          })
        : null,
      can('payroll.approve') ? this.prisma.payrollRun.count({ where: { status: 'DRAFT' } }) : null,
    ]);
    return {
      leavesToApprove,
      punchesToFix: recentDays ? recentDays.filter((d) => ((d.punches as string[] | null) ?? []).length % 2 === 1).length : null,
      unknownCodes,
      devicesWaiting,
      safetyDue,
      payrollToPrepare: can('payroll.create') ? (lastRun ? 0 : 1) : null,
      payrollLastMonth: lastMonth,
      draftPayrolls,
    };
  }

  /** Approved orders with sets not packed yet. */
  private async ordersToPack() {
    const lines = await this.prisma.salesOrderLine.findMany({
      where: { salesOrder: { status: { in: PACKABLE } } },
      select: { salesOrderId: true, quantity: true, assemblyLines: { where: { assembly: { status: { not: 'CANCELLED' } } }, select: { quantity: true } } },
    });
    const open = new Set(lines.filter((l) => Number(l.quantity) > l.assemblyLines.reduce((s, a) => s + Number(a.quantity), 0)).map((l) => l.salesOrderId));
    return open.size;
  }
}

export type WorkTasks = Awaited<ReturnType<DashboardService['tasks']>>;
