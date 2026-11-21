import { Controller, Get } from '@nestjs/common';
import { hasPermission } from '@bht/shared';
import { SalesOrderStatus, StockKind, StockLocation } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, Public, RequirePermission } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { DashboardService } from './dashboard.service';

@Controller()
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
  ) {}

  @Public()
  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Get('dashboard/summary')
  @RequirePermission('dashboard.view')
  async summary(@CurrentUser() user: AuthUser) {
    const [customers, suppliers, products, items, rawMaterials, activeHeats, activeUsers, rmStock, fgStock] =
      await this.prisma.$transaction([
        this.prisma.customer.count({ where: { isActive: true } }),
        this.prisma.supplier.count({ where: { isActive: true } }),
        this.prisma.product.count({ where: { isActive: true } }),
        this.prisma.item.count({ where: { isActive: true } }),
        this.prisma.rawMaterial.count({ where: { isActive: true } }),
        this.prisma.heat.count({ where: { status: 'ACTIVE' } }),
        this.prisma.user.count({ where: { isActive: true } }),
        this.prisma.stockBalance.aggregate({
          where: { kind: StockKind.RAW_MATERIAL, location: StockLocation.RM_STORE },
          _sum: { quantity: true },
        }),
        this.prisma.stockBalance.aggregate({
          where: { kind: StockKind.FINISHED_GOOD, location: StockLocation.FG_STORE },
          _sum: { quantity: true },
        }),
      ]);

    // Raw materials whose RM-store stock is below the reorder level.
    const lowStock = await this.prisma.$queryRaw<{ id: number; code: string; grade: string; size: string; stock: number; reorderLevel: number }[]>`
      SELECT rm.id, rm.code, g.name AS grade, rm.size,
             COALESCE(SUM(sb.quantity), 0) AS stock, rm.reorder_level AS reorderLevel
      FROM raw_materials rm
      JOIN material_grades g ON g.id = rm.grade_id
      LEFT JOIN stock_balances sb ON sb.raw_material_id = rm.id AND sb.location = 'RM_STORE'
      WHERE rm.is_active = 1 AND rm.reorder_level IS NOT NULL AND rm.reorder_level > 0
      GROUP BY rm.id, rm.code, g.name, rm.size, rm.reorder_level
      HAVING stock < rm.reorder_level
      ORDER BY rm.code
      LIMIT 10`;

    const recentActivity = hasPermission(user.permissions, 'audit_log.view')
      ? await this.prisma.auditLog.findMany({
          // data changes only; sign-ins are in the audit log screen
          where: { action: { notIn: ['LOGIN', 'LOGOUT', 'LOGIN_FAILED'] } },
          take: 8,
          orderBy: { id: 'desc' },
          select: { id: true, action: true, summary: true, createdAt: true, user: { select: { name: true } } },
        })
      : [];

    const can = (perm: string) => hasPermission(user.permissions, perm);
    const tasks = await this.dashboard.tasks(user);
    const charts = await this.charts(can);

    // Open orders by promised delivery date (late ones first).
    const dueOrders = can('sales_orders.view')
      ? await this.prisma.salesOrder.findMany({
          where: { status: { in: ['PENDING_APPROVAL', 'APPROVED', 'IN_PRODUCTION', 'PARTIALLY_DISPATCHED'] }, expectedDelivery: { not: null } },
          orderBy: { expectedDelivery: 'asc' },
          take: 6,
          select: { id: true, soNo: true, status: true, expectedDelivery: true, totalAmount: true, currency: true, customer: { select: { name: true } } },
        })
      : null;

    // Open orders with a promised date: still on time vs already late (India date).
    const todayStart = new Date(`${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)}T00:00:00.000Z`);
    const openStatus = { in: ['PENDING_APPROVAL', 'APPROVED', 'IN_PRODUCTION', 'PARTIALLY_DISPATCHED'] as SalesOrderStatus[] };
    const orderTiming = can('sales_orders.view')
      ? await Promise.all([
          this.prisma.salesOrder.count({ where: { status: openStatus, expectedDelivery: { gte: todayStart } } }),
          this.prisma.salesOrder.count({ where: { status: openStatus, expectedDelivery: { lt: todayStart } } }),
        ]).then(([onTrack, late]) => ({ onTrack, late }))
      : null;

    // Who changed things in the ERP in the last 7 days, most active first (for the team row).
    let team: { id: number; name: string; style: unknown; changes: number }[] | null = null;
    if (can('audit_log.view')) {
      const since = new Date(Date.now() - 7 * 86_400_000);
      const counts = await this.prisma.auditLog.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: since }, userId: { not: null }, action: { notIn: ['LOGIN', 'LOGOUT', 'LOGIN_FAILED'] } },
        _count: { _all: true },
      });
      const top = counts.sort((a, b) => b._count._all - a._count._all).slice(0, 8);
      const people = top.length
        ? await this.prisma.user.findMany({ where: { id: { in: top.map((c) => c.userId!) } }, select: { id: true, name: true, preferences: true } })
        : [];
      team = top.flatMap((c) => {
        const u = people.find((p) => p.id === c.userId);
        const prefs = (u?.preferences ?? null) as { avatar?: unknown } | null;
        return u ? [{ id: u.id, name: u.name, style: prefs?.avatar ?? null, changes: c._count._all }] : [];
      });
    }

    // Route cards on the shop floor, by the stage they are at now.
    const wip = can('route_cards.view')
      ? await this.prisma.$queryRaw<{ stage: string | null; seq: number | null; cards: bigint; pcs: number }[]>`
          SELECT ps.name AS stage, ps.sequence AS seq, COUNT(*) AS cards, SUM(rc.planned_qty) AS pcs
          FROM route_cards rc
          LEFT JOIN process_stages ps ON ps.id = rc.current_stage_id
          WHERE rc.status IN ('OPEN', 'IN_PROGRESS')
          GROUP BY ps.name, ps.sequence
          ORDER BY ps.sequence`
      : null;

    // First steps for a new installation (shown to admins until everything is done).
    let setup: Record<string, boolean> | null = null;
    if (can('settings.view')) {
      const [company, employees] = await Promise.all([
        this.prisma.company.findFirst({ where: { isDefault: true }, select: { gstin: true, address: true, bankAccountNo: true } }),
        this.prisma.employee.count(),
      ]);
      setup = {
        company: !!(company?.gstin && company.address && company.bankAccountNo),
        users: activeUsers > 1,
        customers: customers > 0,
        suppliers: suppliers > 0,
        products: products > 0 && items > 0,
        rawMaterials: rawMaterials > 0,
        employees: employees > 0,
      };
    }

    return {
      dueOrders: dueOrders?.map((o) => ({ ...o, totalAmount: Number(o.totalAmount) })) ?? null,
      orderTiming,
      team,
      wip: wip?.map((w) => ({ stage: w.stage ?? 'Waiting for material', cards: Number(w.cards), pcs: Number(w.pcs ?? 0) })) ?? null,
      setup,
      charts,
      counts: { customers, suppliers, products, items, rawMaterials, activeHeats, activeUsers },
      tasks,
      stock: {
        rawMaterialKg: rmStock._sum.quantity?.toNumber() ?? 0,
        finishedGoodsPcs: fgStock._sum.quantity?.toNumber() ?? 0,
      },
      lowStock: lowStock.map((r) => ({ ...r, stock: Number(r.stock), reorderLevel: Number(r.reorderLevel) })),
      recentActivity,
    };
  }

  /** Data for the dashboard charts; null when the user may not see that screen. */
  private async charts(can: (perm: string) => boolean) {
    // the last 12 months (India time), oldest first
    const now = new Date(Date.now() + 330 * 60_000);
    const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1)).toISOString().slice(0, 7));
    const from = `${months[0]}-01`;

    const [orders, made, jobWork, rmByGrade] = await Promise.all([
      can('sales_orders.view')
        ? this.prisma.salesOrder.groupBy({
            by: ['status'],
            where: { status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_PRODUCTION', 'PARTIALLY_DISPATCHED'] } },
            _count: { _all: true },
          })
        : null,
      can('route_cards.view') || can('reports.view')
        ? this.prisma.$queryRaw<{ month: string; qty: number }[]>`
            SELECT DATE_FORMAT(DATE_ADD(created_at, INTERVAL 330 MINUTE), '%Y-%m') AS month, SUM(ok_qty) AS qty
            FROM rc_completions
            WHERE created_at >= DATE_SUB(${from}, INTERVAL 330 MINUTE)
            GROUP BY month`
        : null,
      can('route_cards.view') || can('reports.view')
        ? this.prisma.$queryRaw<{ month: string; qty: number }[]>`
            SELECT DATE_FORMAT(r.receipt_date, '%Y-%m') AS month, SUM(l.accepted_qty) AS qty
            FROM job_work_receipt_lines l JOIN job_work_receipts r ON r.id = l.job_work_receipt_id
            WHERE r.receipt_date >= ${from}
            GROUP BY month`
        : null,
      can('stock.view') || can('raw_materials.view')
        ? this.prisma.$queryRaw<{ grade: string; kg: number }[]>`
            SELECT g.name AS grade, SUM(sb.quantity) AS kg
            FROM stock_balances sb
            JOIN raw_materials rm ON rm.id = sb.raw_material_id
            JOIN material_grades g ON g.id = rm.grade_id
            WHERE sb.location = 'RM_STORE' AND sb.quantity > 0
            GROUP BY g.name
            ORDER BY kg DESC`
        : null,
    ]);

    const byMonth = (rows: { month: string; qty: number }[]) => new Map(rows.map((r) => [r.month, Math.round(Number(r.qty) * 1000) / 1000]));
    const madeMap = made ? byMonth(made) : null;
    const jwMap = jobWork ? byMonth(jobWork) : null;
    // the 6 biggest grades, the rest summed as "Other"
    const grades = rmByGrade?.map((r) => ({ grade: r.grade, kg: Math.round(Number(r.kg) * 1000) / 1000 })) ?? null;
    const topGrades = grades && grades.length > 7 ? [...grades.slice(0, 6), { grade: 'Other grades', kg: grades.slice(6).reduce((s, r) => s + r.kg, 0) }] : grades;

    return {
      orders: orders && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_PRODUCTION', 'PARTIALLY_DISPATCHED'].map((status) => ({ status, orders: orders.find((o) => o.status === status)?._count._all ?? 0 })),
      production: madeMap && jwMap ? months.map((month) => ({ month, made: madeMap.get(month) ?? 0, jobWork: jwMap.get(month) ?? 0 })) : null,
      rmByGrade: topGrades,
    };
  }
}
