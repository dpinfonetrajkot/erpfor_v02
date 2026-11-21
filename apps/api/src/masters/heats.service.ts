import { Injectable } from '@nestjs/common';
import type { HeatInput, ListQuery } from '@bht/shared';
import {
  AuditAction,
  HeatStatus,
  StockKind,
  StockLocation,
  StockRefType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { StockService } from '../core/stock.service';
import { listArgs, paginated } from '../common/list';
import { diff, normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';

const heatInclude = {
  rawMaterial: { select: { id: true, code: true, size: true, grade: { select: { id: true, name: true } } } },
  supplier: { select: { id: true, name: true } },
} as const;

export interface HeatFilters {
  rawMaterialId?: number;
  status?: HeatStatus;
}

@Injectable()
export class HeatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
  ) {}

  async list(query: ListQuery, filters: HeatFilters) {
    const args = listArgs(
      query,
      {
        searchFields: ['heatNo', 'millHeatNo', 'rawMaterial.size', 'rawMaterial.grade.name', 'supplier.name'],
        sortable: ['heatNo', 'millHeatNo', 'receivedDate', 'status', 'createdAt'],
        defaultSort: { field: 'createdAt', dir: 'desc' },
      },
      {
        ...(filters.rawMaterialId ? { rawMaterialId: filters.rawMaterialId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
    );
    const [heats, total] = await this.prisma.$transaction([
      this.prisma.heat.findMany({ ...args, include: heatInclude }),
      this.prisma.heat.count({ where: args.where }),
    ]);

    const stock = await this.prisma.stockBalance.groupBy({
      by: ['heatId'],
      where: {
        kind: StockKind.RAW_MATERIAL,
        location: StockLocation.RM_STORE,
        heatId: { in: heats.map((h) => h.id) },
      },
      _sum: { quantity: true },
    });
    const qty = new Map(stock.map((s) => [s.heatId, s._sum.quantity?.toNumber() ?? 0]));
    return paginated(
      heats.map((h) => ({ ...h, stockQty: qty.get(h.id) ?? 0 })),
      total,
      query,
    );
  }

  get(id: number) {
    return this.prisma.heat.findUniqueOrThrow({ where: { id }, include: heatInclude });
  }

  create(input: HeatInput, actor: Actor) {
    const { openingQty, ...fields } = input;
    return this.prisma.$transaction(async (tx) => {
      const rawMaterial = await tx.rawMaterial.findUniqueOrThrow({
        where: { id: fields.rawMaterialId },
        include: { grade: true },
      });
      const heatNo =
        fields.heatNo?.toUpperCase() ||
        (await this.numbering.next('HEAT', {
          tx,
          date: fields.receivedDate ? new Date(fields.receivedDate) : undefined,
          vars: { GRADE: rawMaterial.grade.heatCode ?? rawMaterial.grade.name.charAt(0) },
        }));

      const heat = await tx.heat.create({
        data: { ...normalize(fields), heatNo },
        include: heatInclude,
      });

      if (openingQty && openingQty > 0) {
        await this.stock.post(tx, {
          kind: StockKind.RAW_MATERIAL,
          rawMaterialId: heat.rawMaterialId,
          heatId: heat.id,
          location: StockLocation.RM_STORE,
          quantity: openingQty,
          refType: StockRefType.OPENING,
          refId: heat.id,
          refNo: heat.heatNo,
          remarks: 'Opening stock',
          userId: actor.userId,
        });
      }

      await this.audit.log(
        actor,
        {
          action: AuditAction.CREATE,
          entity: 'heat',
          entityId: heat.id,
          summary: `Created heat ${heat.heatNo}${openingQty ? ` with opening stock ${openingQty} kg` : ''}`,
        },
        tx,
      );
      return heat;
    });
  }

  async update(id: number, input: HeatInput, actor: Actor) {
    const { openingQty: _ignored, ...fields } = input;
    const before = await this.get(id);
    const heat = await this.prisma.heat.update({
      where: { id },
      data: { ...normalize(fields), heatNo: fields.heatNo?.toUpperCase() || before.heatNo },
      include: heatInclude,
    });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'heat',
      entityId: id,
      summary: `Updated heat ${heat.heatNo}`,
      changes: diff(before, heat),
    });
    return heat;
  }

  async remove(id: number, actor: Actor) {
    const heat = await this.get(id);
    await this.prisma.heat.delete({ where: { id } });
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'heat',
      entityId: id,
      summary: `Deleted heat ${heat.heatNo}`,
      changes: heat,
    });
  }
}
