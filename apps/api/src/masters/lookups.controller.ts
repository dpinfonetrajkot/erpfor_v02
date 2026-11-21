import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface LookupOption {
  value: number;
  label: string;
  /** Extra data some forms need (e.g. hasEndConnection for part types). */
  meta?: Record<string, unknown>;
}

type Loader = (prisma: PrismaService) => Promise<LookupOption[]>;

/**
 * Small {value, label} lists for dropdowns. Any logged-in user may read them,
 * so e.g. Sales can pick a product without full access to the product master.
 * Only active records are returned.
 */
const LOADERS: Record<string, Loader> = {
  customers: async (p) =>
    (await p.customer.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, currency: true } }))
      .map((r) => ({ value: r.id, label: r.name, meta: { code: r.code, currency: r.currency } })),
  suppliers: async (p) =>
    (await p.supplier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }))
      .map((r) => ({ value: r.id, label: r.name, meta: { type: r.type, code: r.code, stateCode: r.stateCode, country: r.country, paymentTermsDays: r.paymentTermsDays, email: r.email } })),
  productCategories: async (p) =>
    (await p.productCategory.findMany({ orderBy: { name: 'asc' } })).map((r) => ({ value: r.id, label: r.name })),
  partTypes: async (p) =>
    (await p.partType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }))
      .map((r) => ({ value: r.id, label: r.name, meta: { hasEndConnection: r.hasEndConnection } })),
  products: async (p) =>
    (await p.product.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, hsnCode: true, components: { select: { partType: { select: { hasEndConnection: true } } } } },
    })).map((r) => ({
      value: r.id,
      label: r.name,
      meta: { code: r.code, hsnCode: r.hsnCode, needsEndConnection: r.components.some((c) => c.partType.hasEndConnection), hasBom: r.components.length > 0 },
    })),
  items: async (p) =>
    (await p.item.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } }))
      .map((r) => ({ value: r.id, label: r.name, meta: { code: r.code } })),
  /** What can go on an invoice line: finished products (sets) and single parts, with HSN, unit and minimum price. */
  saleItems: async (p) => {
    const [products, items] = await Promise.all([
      p.product.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, hsnCode: true } }),
      p.item.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, hsnCode: true, uom: true, minPrice: true } }),
    ]);
    return [
      ...products.map((r) => ({ value: r.id, label: r.name, meta: { kind: 'Product', code: r.code, hsnCode: r.hsnCode, uom: 'SET', price: null } })),
      ...items.map((r) => ({ value: r.id, label: r.name, meta: { kind: 'Part', code: r.code, hsnCode: r.hsnCode, uom: r.uom, price: r.minPrice ? Number(r.minPrice) : null } })),
    ];
  },
  materialGrades: async (p) =>
    (await p.materialGrade.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } })).map((r) => ({ value: r.id, label: r.name })),
  rawMaterials: async (p) =>
    (await p.rawMaterial.findMany({
      where: { isActive: true },
      orderBy: [{ grade: { name: 'asc' } }, { size: 'asc' }],
      select: { id: true, code: true, size: true, uom: true, grade: { select: { name: true } } },
    })).map((r) => ({ value: r.id, label: `${r.grade.name} — ${r.size}`, meta: { code: r.code, uom: r.uom } })),
  companies: async (p) =>
    (await p.company.findMany({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }))
      .map((r) => ({ value: r.id, label: r.name, meta: { code: r.code, stateCode: r.stateCode, isDefault: r.isDefault, address: [r.address, r.city, r.pincode].filter(Boolean).join(', '), purchaseTerms: r.purchaseTerms, gstin: r.gstin, phone: r.phone, email: r.email, legalName: r.legalName, bankName: r.bankName, bankAccountNo: r.bankAccountNo, bankIfsc: r.bankIfsc, bankBranch: r.bankBranch } })),
  users: async (p) =>
    (await p.user.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }))
      .map((r) => ({ value: r.id, label: r.name })),
  roles: async (p) =>
    (await p.role.findMany({ orderBy: { name: 'asc' } })).map((r) => ({ value: r.id, label: r.name })),
  processStages: async (p) =>
    (await p.processStage.findMany({ where: { isActive: true }, orderBy: { sequence: 'asc' } }))
      .map((r) => ({ value: r.id, label: r.name, meta: { code: r.code } })),
  /** Working employees, by code number. */
  employees: async (p) =>
    (await p.employee.findMany({ where: { status: 'ACTIVE' }, select: { id: true, empCode: true, name: true } }))
      .sort((a, b) => a.empCode.localeCompare(b.empCode, 'en', { numeric: true }))
      .map((r) => ({ value: r.id, label: `${r.empCode} - ${r.name}`, meta: { code: r.empCode } })),
  departments: async (p) =>
    (await p.department.findMany({ orderBy: { name: 'asc' } })).map((r) => ({ value: r.id, label: r.name })),
};

@Controller('lookups')
export class LookupsController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /lookups?types=customers,products */
  @Get()
  async get(@Query('types') types = ''): Promise<Record<string, LookupOption[]>> {
    const wanted = types.split(',').map((t) => t.trim()).filter(Boolean);
    const unknown = wanted.filter((t) => !LOADERS[t]);
    if (!wanted.length || unknown.length) {
      throw new BadRequestException(`Unknown lookup type(s): ${unknown.join(', ') || '(none)'}`);
    }
    const lists = await Promise.all(wanted.map((t) => LOADERS[t](this.prisma)));
    return Object.fromEntries(wanted.map((t, i) => [t, lists[i]]));
  }
}
