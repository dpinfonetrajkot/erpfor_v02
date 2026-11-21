import { STOCK_LOCATION_LABELS } from '@bht/shared';
import { StockKind, StockLocation } from '../../generated/prisma/client';
import { has, hits } from '../language';
import { day, num, plural, qty, R, table, type Params, type Reply, type Topic } from '../kit';

const STOCK_WORDS = ['stock', 'available', 'have', 'kg', 'balance', 'store', 'left', 'how much', 'inventory', 'qty', 'quantity', 'pcs', 'pieces', 'ready'];

export const stockTopics: Topic[] = [
  {
    id: 'rm_stock',
    area: 'Stock',
    label: 'raw material stock',
    permissions: ['stock.view'],
    examples: ['Stock of 4130 90 mm round', 'How much A105 do we have?', 'Raw material stock'],
    score: (p, f) => {
      const stockWords = hits(p, STOCK_WORDS) > 0 ? 3 : 0;
      const rm = (f.materialAsked ? 3 : 0) + (has(p, 'rm', 'bar', 'bars', 'material') ? 2 : 0);
      return rm ? stockWords + rm : 0;
    },
    async answer(ask) {
      const ids = ask.ids(ask.found.materials, 'materialIds');
      if (!ids.length && ask.found.materialAsked) {
        const grades = ask.found.grades.map((g) => g.id);
        const sizes = grades.length ? await ask.prisma.rawMaterial.findMany({ where: { gradeId: { in: grades }, isActive: true }, orderBy: { size: 'asc' }, take: 6, select: { size: true, grade: { select: { name: true } } } }) : [];
        return {
          understood: 'Raw material stock',
          text: `I could not find that raw material size in the masters.${sizes.length ? ' Sizes of this grade are, for example:' : ''}`,
          suggestions: sizes.map((s) => `Stock of ${s.grade.name} ${s.size.toLowerCase()}`),
          links: [{ label: 'Raw materials', href: '/masters/raw-materials' }],
        };
      }
      const balances = await ask.prisma.stockBalance.findMany({
        where: { kind: StockKind.RAW_MATERIAL, quantity: { not: 0 }, ...(ids.length ? { rawMaterialId: { in: ids } } : {}) },
        select: {
          quantity: true,
          location: true,
          rawMaterialId: true,
          rawMaterial: { select: { code: true, size: true, grade: { select: { name: true } } } },
          heat: { select: { heatNo: true, millHeatNo: true, receivedDate: true } },
        },
      });
      const params: Params = ids.length ? { materialIds: ids.join(',') } : {};
      if (!ids.length) {
        // no material named: the RM store by grade
        const byGrade = new Map<string, number>();
        for (const b of balances.filter((x) => x.location === StockLocation.RM_STORE)) byGrade.set(b.rawMaterial!.grade.name, (byGrade.get(b.rawMaterial!.grade.name) ?? 0) + num(b.quantity));
        const total = [...byGrade.values()].reduce((s, v) => s + v, 0);
        return {
          understood: 'Raw material stock · all grades',
          text: `The RM store holds ${qty(total, 'kg')} of raw material.`,
          table: table(['Grade', R('In RM store')], [...byGrade.entries()].sort((a, b) => b[1] - a[1]).map(([g, v]) => [g, qty(v, 'kg')])),
          links: [{ label: 'Raw material stock', href: '/store/stock?tab=rm' }],
          suggestions: ['Which raw material is below reorder level?'],
        };
      }
      const materials = await ask.prisma.rawMaterial.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, size: true, grade: { select: { name: true } } }, orderBy: { code: 'asc' } });
      const name = (m: { size: string; grade: { name: string } }) => `${m.grade.name} ${m.size}`;
      const store = (id: number) => balances.filter((b) => b.rawMaterialId === id && b.location === StockLocation.RM_STORE).reduce((s, b) => s + num(b.quantity), 0);
      const elsewhere = (id: number) => balances.filter((b) => b.rawMaterialId === id && b.location !== StockLocation.RM_STORE).reduce((s, b) => s + num(b.quantity), 0);
      const search = materials.length === 1 ? materials[0].size : (ask.found.grades[0]?.name ?? '');
      const link = { label: 'Raw material stock', href: `/store/stock?tab=rm&search=${encodeURIComponent(search)}` };

      if (materials.length === 1) {
        const m = materials[0];
        const rows = balances.filter((b) => b.rawMaterialId === m.id).sort((a, b) => (a.heat?.receivedDate?.getTime() ?? 0) - (b.heat?.receivedDate?.getTime() ?? 0));
        const other = elsewhere(m.id);
        return {
          understood: `Raw material stock · ${name(m)}`,
          text: rows.length
            ? `${name(m)} (${m.code}): ${qty(store(m.id), 'kg')} in the RM store${other ? `, plus ${qty(other, 'kg')} elsewhere (shop floor / job work)` : ''}, in ${plural(new Set(rows.map((r) => r.heat?.heatNo)).size, 'heat')}. Oldest heat first:`
            : `There is no stock of ${name(m)} (${m.code}).`,
          ...(rows.length
            ? { table: table(['Heat', 'Mill heat', 'Received', 'Where', R('Kg')], rows.map((r) => [r.heat?.heatNo ?? '—', r.heat?.millHeatNo ?? '—', day(r.heat?.receivedDate), STOCK_LOCATION_LABELS[r.location], qty(num(r.quantity))])) }
            : {}),
          links: [link],
          params,
        };
      }
      const rows = materials.map((m) => ({ m, store: store(m.id), other: elsewhere(m.id) })).sort((a, b) => b.store - a.store);
      const total = rows.reduce((s, r) => s + r.store, 0);
      return {
        understood: `Raw material stock · ${ask.found.grades.map((g) => g.name).join(', ') || 'several sizes'}`,
        text: `${plural(rows.length, 'size')} found, ${qty(total, 'kg')} in the RM store in all.`,
        table: table(['Code', 'Material', R('RM store kg'), R('Elsewhere kg')], rows.map((r) => [r.m.code, name(r.m), qty(r.store), r.other ? qty(r.other) : '—']), 12),
        links: [link],
        params,
      };
    },
  },

  {
    id: 'fg_stock',
    area: 'Stock',
    label: 'finished parts stock',
    permissions: ['stock.view'],
    examples: ['Stock of 2 inch fig 1502 male', 'Finished parts in store'],
    score: (p, f) => {
      const stockWords = hits(p, STOCK_WORDS) > 0 ? 3 : 0;
      const fg = (f.items.length || f.products.length ? 4 : 0) + (has(p, 'fg', 'finished', 'parts', 'part', 'ready') ? 2 : 0);
      return fg ? stockWords + fg : 0;
    },
    async answer(ask) {
      const itemIds = ask.ids(ask.found.items, 'itemIds');
      const productIds = ask.found.products.map((x) => x.id);
      const where = itemIds.length ? { itemId: { in: itemIds } } : productIds.length ? { item: { productId: { in: productIds } } } : {};
      const balances = await ask.prisma.stockBalance.findMany({
        where: { kind: StockKind.FINISHED_GOOD, location: StockLocation.FG_STORE, quantity: { not: 0 }, ...where },
        select: { quantity: true, itemId: true, item: { select: { code: true, name: true } }, heat: { select: { heatNo: true } } },
      });
      const byItem = new Map<number, { code: string; name: string; qty: number; heats: Set<string> }>();
      for (const b of balances) {
        const row = byItem.get(b.itemId!) ?? { code: b.item!.code, name: b.item!.name, qty: 0, heats: new Set<string>() };
        row.qty += num(b.quantity);
        if (b.heat) row.heats.add(b.heat.heatNo);
        byItem.set(b.itemId!, row);
      }
      const rows = [...byItem.values()].sort((a, b) => b.qty - a.qty);
      const total = rows.reduce((s, r) => s + r.qty, 0);
      const params: Params = itemIds.length ? { itemIds: itemIds.join(',') } : {};
      const named = itemIds.length || productIds.length;
      if (itemIds.length === 1) {
        const item = await ask.prisma.item.findUnique({ where: { id: itemIds[0] }, select: { code: true, name: true } });
        const heats = balances.map((b) => [b.heat?.heatNo ?? '—', qty(num(b.quantity))]);
        return {
          understood: `Finished parts stock · ${item?.name}`,
          text: total ? `${item?.name} (${item?.code}): ${qty(total, 'pcs')} in the FG store.` : `There is no ${item?.name} in the FG store.`,
          ...(heats.length ? { table: table(['Heat', R('Pcs')], heats) } : {}),
          links: [{ label: 'Finished goods stock', href: `/store/stock?tab=fg&search=${encodeURIComponent(item?.code ?? '')}` }],
          params,
        };
      }
      if (named && !rows.length) return { understood: 'Finished parts stock', text: 'None of these parts is in the FG store now.', links: [{ label: 'Finished goods stock', href: '/store/stock?tab=fg' }], params };
      return {
        understood: named ? `Finished parts stock · ${plural(rows.length, 'part')}` : 'Finished parts stock · all parts',
        text: `${qty(total, 'pcs')} in the FG store${named ? '' : ` across ${plural(rows.length, 'part')}`}. Most first:`,
        table: table(['Part', R('Pcs'), R('Heats')], rows.map((r) => [r.name, qty(r.qty), String(r.heats.size)]), 12),
        links: [{ label: 'Finished goods stock', href: '/store/stock?tab=fg' }],
        params,
      };
    },
  },

  {
    id: 'low_stock',
    area: 'Stock',
    label: 'raw material reorder list',
    permissions: ['stock.view'],
    examples: ['Which raw material is below reorder level?'],
    score: (p) => (has(p, 'low', 'reorder', 'below', 'short', 'shortage', 'running out', 'finishing', 'to order', 'to buy') && has(p, 'stock', 'rm', 'material', 'materials', 'bar', 'reorder') ? 7 : 0),
    async answer(ask) {
      const rows = await ask.prisma.$queryRaw<{ code: string; grade: string; size: string; stock: number; reorderLevel: number }[]>`
        SELECT rm.code, g.name AS grade, rm.size, COALESCE(SUM(sb.quantity), 0) AS stock, rm.reorder_level AS reorderLevel
        FROM raw_materials rm
        JOIN material_grades g ON g.id = rm.grade_id
        LEFT JOIN stock_balances sb ON sb.raw_material_id = rm.id AND sb.location = 'RM_STORE'
        WHERE rm.is_active = 1 AND rm.reorder_level IS NOT NULL AND rm.reorder_level > 0
        GROUP BY rm.id, rm.code, g.name, rm.size, rm.reorder_level
        HAVING stock < rm.reorder_level
        ORDER BY rm.code`;
      const reply: Reply = rows.length
        ? {
            text: `${plural(rows.length, 'raw material is', 'raw materials are')} below the reorder level:`,
            table: table(['Code', 'Material', R('In store kg'), R('Reorder at kg')], rows.map((r) => [r.code, `${r.grade} ${r.size}`, qty(Number(r.stock)), qty(Number(r.reorderLevel))]), 15),
          }
        : { text: 'All raw materials with a reorder level are above it.' };
      return {
        ...reply,
        understood: 'Raw material below reorder level',
        links: ask.can('purchase_requisitions.view') ? [{ label: 'Purchase requisitions', href: '/purchase/requisitions' }] : [],
      };
    },
  },
];
