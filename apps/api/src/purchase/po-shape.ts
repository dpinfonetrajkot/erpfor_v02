import type { Prisma } from '../generated/prisma/client';

/** What is loaded for one purchase order (screen, PDF, e-mail). */
export const poInclude = {
  company: true,
  supplier: true,
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      rawMaterial: { select: { id: true, code: true, size: true, uom: true, grade: { select: { name: true } } } },
      item: { select: { id: true, code: true, name: true } },
      purchaseRequisition: { select: { id: true, prNo: true } },
    },
  },
  goodsReceipts: { select: { id: true, grnNo: true, grnDate: true, status: true }, orderBy: { id: 'asc' } },
  jobWorkOrder: { select: { id: true, jwoNo: true } },
} as const satisfies Prisma.PurchaseOrderInclude;

export type PurchaseOrderFull = Prisma.PurchaseOrderGetPayload<{ include: typeof poInclude }>;

/** "A105 - 60 MM ROUND" for material lines, the item name for job-work lines. */
export function poLineLabel(line: PurchaseOrderFull['lines'][number]): { title: string; code: string } {
  if (line.rawMaterial) return { title: `${line.rawMaterial.grade.name} - ${line.rawMaterial.size}`, code: line.rawMaterial.code };
  return { title: line.item?.name ?? line.description ?? '-', code: line.item?.code ?? '' };
}

