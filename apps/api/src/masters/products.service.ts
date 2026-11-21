import { Injectable } from '@nestjs/common';
import type { ListQuery, PartTypeInput, ProductCategoryInput, ProductInput } from '@bht/shared';
import { AuditAction, EndConnection } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { listArgs, paginated } from '../common/list';
import { diff, normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';
import { itemName } from './item-name';

const productInclude = {
  category: { select: { id: true, name: true } },
  components: {
    select: { partTypeId: true, quantity: true, partType: { select: { name: true, hasEndConnection: true } } },
    orderBy: { partType: { sortOrder: 'asc' } },
  },
  _count: { select: { items: true } },
} as const;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  // ---------------------------------------------------------------- categories

  listCategories() {
    return this.prisma.productCategory.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  async saveCategory(id: number | null, input: ProductCategoryInput, actor: Actor) {
    const data = normalize(input);
    const before = id ? await this.prisma.productCategory.findUniqueOrThrow({ where: { id } }) : null;
    const row = id
      ? await this.prisma.productCategory.update({ where: { id }, data })
      : await this.prisma.productCategory.create({ data });
    await this.audit.log(actor, {
      action: id ? AuditAction.UPDATE : AuditAction.CREATE,
      entity: 'product_category',
      entityId: row.id,
      summary: `${id ? 'Updated' : 'Created'} product category ${row.name}`,
      changes: before ? diff(before, row) : undefined,
    });
    return row;
  }

  async removeCategory(id: number, actor: Actor) {
    const row = await this.prisma.productCategory.delete({ where: { id } });
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'product_category',
      entityId: id,
      summary: `Deleted product category ${row.name}`,
    });
  }

  // ---------------------------------------------------------------- part types

  listPartTypes() {
    return this.prisma.partType.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { items: true } } },
    });
  }

  async savePartType(id: number | null, input: PartTypeInput, actor: Actor) {
    const data = { ...input, name: input.name.toUpperCase() };
    const before = id ? await this.prisma.partType.findUniqueOrThrow({ where: { id } }) : null;
    const row = id
      ? await this.prisma.partType.update({ where: { id }, data })
      : await this.prisma.partType.create({ data });
    await this.audit.log(actor, {
      action: id ? AuditAction.UPDATE : AuditAction.CREATE,
      entity: 'part_type',
      entityId: row.id,
      summary: `${id ? 'Updated' : 'Created'} part type ${row.name}`,
      changes: before ? diff(before, row) : undefined,
    });
    return row;
  }

  async removePartType(id: number, actor: Actor) {
    const row = await this.prisma.partType.delete({ where: { id } });
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'part_type',
      entityId: id,
      summary: `Deleted part type ${row.name}`,
    });
  }

  // ------------------------------------------------------------------ products

  async list(query: ListQuery, categoryId?: number) {
    const args = listArgs(
      query,
      {
        searchFields: ['code', 'name', 'figure', 'size', 'category.name'],
        sortable: ['code', 'name', 'size', 'createdAt'],
        defaultSort: { field: 'name', dir: 'asc' },
        activeField: 'isActive',
      },
      categoryId ? { categoryId } : {},
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({ ...args, include: productInclude }),
      this.prisma.product.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  get(id: number) {
    return this.prisma.product.findUniqueOrThrow({ where: { id }, include: productInclude });
  }

  create(input: ProductInput, actor: Actor) {
    const { components, ...fields } = input;
    return this.prisma.$transaction(async (tx) => {
      const code = fields.code || (await this.numbering.next('PRODUCT', { tx }));
      const product = await tx.product.create({
        data: {
          ...normalize(fields),
          code,
          components: { create: uniqueComponents(components) },
        },
        include: productInclude,
      });
      await this.audit.log(
        actor,
        { action: AuditAction.CREATE, entity: 'product', entityId: product.id, summary: `Created product ${product.name}` },
        tx,
      );
      return product;
    });
  }

  async update(id: number, input: ProductInput, actor: Actor) {
    const { components, ...fields } = input;
    const before = await this.get(id);
    const product = await this.prisma.$transaction(async (tx) => {
      await tx.productComponent.deleteMany({ where: { productId: id } });
      const updated = await tx.product.update({
        where: { id },
        data: {
          ...normalize(fields),
          code: fields.code || before.code,
          components: { create: uniqueComponents(components) },
        },
        include: productInclude,
      });
      // Keep item names in step with a renamed product.
      if (updated.name !== before.name) {
        const items = await tx.item.findMany({ where: { productId: id }, include: { partType: true } });
        for (const item of items) {
          await tx.item.update({
            where: { id: item.id },
            data: { name: itemName(updated.name, item.partType.name, item.endConnection) },
          });
        }
      }
      return updated;
    });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'product',
      entityId: id,
      summary: `Updated product ${product.name}`,
      changes: diff(before, product),
    });
    return product;
  }

  async remove(id: number, actor: Actor) {
    const product = await this.get(id);
    await this.prisma.product.delete({ where: { id } });
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'product',
      entityId: id,
      summary: `Deleted product ${product.name}`,
      changes: product,
    });
  }

  /**
   * Creates the missing items for a product: every BOM part, once per chosen
   * end connection (parts without an end connection, like the NUT, get one item).
   */
  async generateItems(id: number, endConnections: EndConnection[], actor: Actor) {
    const product = await this.get(id);
    const ends = endConnections.length ? endConnections : [EndConnection.NONE];

    const created = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.item.findMany({
        where: { productId: id },
        select: { partTypeId: true, endConnection: true },
      });
      const has = new Set(existing.map((e) => `${e.partTypeId}:${e.endConnection}`));
      const names: string[] = [];

      for (const component of product.components) {
        const variants = component.partType.hasEndConnection
          ? ends.filter((e) => e !== EndConnection.NONE)
          : [EndConnection.NONE];
        for (const endConnection of variants.length ? variants : [EndConnection.NONE]) {
          if (has.has(`${component.partTypeId}:${endConnection}`)) continue;
          const name = itemName(product.name, component.partType.name, endConnection);
          await tx.item.create({
            data: {
              code: await this.numbering.next('ITEM', { tx }),
              name,
              productId: id,
              partTypeId: component.partTypeId,
              endConnection,
              hsnCode: product.hsnCode,
            },
          });
          names.push(name);
        }
      }
      return names;
    });

    if (created.length) {
      await this.audit.log(actor, {
        action: AuditAction.CREATE,
        entity: 'item',
        summary: `Generated ${created.length} item(s) for ${product.name}`,
        changes: { items: created },
      });
    }
    return { created };
  }
}

function uniqueComponents(components: ProductInput['components']) {
  const byPart = new Map<number, number>();
  for (const c of components) byPart.set(c.partTypeId, c.quantity);
  return [...byPart].map(([partTypeId, quantity]) => ({ partTypeId, quantity }));
}
