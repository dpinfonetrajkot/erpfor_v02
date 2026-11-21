import { Injectable } from '@nestjs/common';
import type { ListQuery, MaterialGradeInput, RawMaterialInput } from '@bht/shared';
import { AuditAction, StockKind, StockLocation } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { listArgs, paginated } from '../common/list';
import { diff, normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';

const rawMaterialInclude = {
  grade: { select: { id: true, name: true } },
  _count: { select: { heats: true } },
} as const;

@Injectable()
export class RawMaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  // ------------------------------------------------------------ material grades

  listGrades() {
    return this.prisma.materialGrade.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { rawMaterials: true } } },
    });
  }

  async saveGrade(id: number | null, input: MaterialGradeInput, actor: Actor) {
    const data = { ...normalize(input), name: input.name.toUpperCase() };
    const before = id ? await this.prisma.materialGrade.findUniqueOrThrow({ where: { id } }) : null;
    const row = id
      ? await this.prisma.materialGrade.update({ where: { id }, data })
      : await this.prisma.materialGrade.create({ data });
    await this.audit.log(actor, {
      action: id ? AuditAction.UPDATE : AuditAction.CREATE,
      entity: 'material_grade',
      entityId: row.id,
      summary: `${id ? 'Updated' : 'Created'} material grade ${row.name}`,
      changes: before ? diff(before, row) : undefined,
    });
    return row;
  }

  async removeGrade(id: number, actor: Actor) {
    const row = await this.prisma.materialGrade.delete({ where: { id } });
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'material_grade',
      entityId: id,
      summary: `Deleted material grade ${row.name}`,
    });
  }

  // -------------------------------------------------------------- raw materials

  async list(query: ListQuery, gradeId?: number) {
    const args = listArgs(
      query,
      {
        searchFields: ['code', 'size', 'grade.name'],
        sortable: ['code', 'size', 'shape', 'createdAt'],
        defaultSort: { field: 'code', dir: 'asc' },
        activeField: 'isActive',
      },
      gradeId ? { gradeId } : {},
    );
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.rawMaterial.findMany({ ...args, include: rawMaterialInclude }),
      this.prisma.rawMaterial.count({ where: args.where }),
    ]);

    const stock = await this.prisma.stockBalance.groupBy({
      by: ['rawMaterialId'],
      where: {
        kind: StockKind.RAW_MATERIAL,
        location: StockLocation.RM_STORE,
        rawMaterialId: { in: rows.map((r) => r.id) },
      },
      _sum: { quantity: true },
    });
    const qty = new Map(stock.map((s) => [s.rawMaterialId, s._sum.quantity?.toNumber() ?? 0]));
    return paginated(
      rows.map((r) => ({
        ...r,
        stockQty: qty.get(r.id) ?? 0,
        belowReorder: r.reorderLevel != null && (qty.get(r.id) ?? 0) < r.reorderLevel.toNumber(),
      })),
      total,
      query,
    );
  }

  get(id: number) {
    return this.prisma.rawMaterial.findUniqueOrThrow({ where: { id }, include: rawMaterialInclude });
  }

  create(input: RawMaterialInput, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const code = input.code || (await this.numbering.next('RAW_MATERIAL', { tx }));
      const row = await tx.rawMaterial.create({
        data: { ...normalize(input), code, size: input.size.toUpperCase() },
        include: rawMaterialInclude,
      });
      await this.audit.log(
        actor,
        {
          action: AuditAction.CREATE,
          entity: 'raw_material',
          entityId: row.id,
          summary: `Created raw material ${row.grade.name} ${row.size}`,
        },
        tx,
      );
      return row;
    });
  }

  async update(id: number, input: RawMaterialInput, actor: Actor) {
    const before = await this.get(id);
    const row = await this.prisma.rawMaterial.update({
      where: { id },
      data: { ...normalize(input), code: input.code || before.code, size: input.size.toUpperCase() },
      include: rawMaterialInclude,
    });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'raw_material',
      entityId: id,
      summary: `Updated raw material ${row.grade.name} ${row.size}`,
      changes: diff(before, row),
    });
    return row;
  }

  async remove(id: number, actor: Actor) {
    const row = await this.get(id);
    await this.prisma.rawMaterial.delete({ where: { id } });
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'raw_material',
      entityId: id,
      summary: `Deleted raw material ${row.grade.name} ${row.size}`,
      changes: row,
    });
  }
}
