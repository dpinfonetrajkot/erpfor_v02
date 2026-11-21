import { has } from '../language';
import { plural, type Ask, type Topic } from '../kit';

/** "How many ..." for the masters and people; each needs its own view permission. */
const COUNTS: { words: string[]; permission: string; what: [string, string]; count: (ask: Ask) => Promise<number>; href: string }[] = [
  { words: ['customer', 'customers', 'client', 'clients'], permission: 'customers.view', what: ['active customer', 'active customers'], count: (a) => a.prisma.customer.count({ where: { isActive: true } }), href: '/masters/customers' },
  { words: ['supplier', 'suppliers', 'vendor', 'vendors'], permission: 'suppliers.view', what: ['active supplier / vendor', 'active suppliers / vendors'], count: (a) => a.prisma.supplier.count({ where: { isActive: true } }), href: '/masters/suppliers' },
  { words: ['product', 'products'], permission: 'products.view', what: ['product', 'products'], count: (a) => a.prisma.product.count({ where: { isActive: true } }), href: '/masters/products' },
  { words: ['item', 'items', 'part', 'parts'], permission: 'items.view', what: ['part (item)', 'parts (items)'], count: (a) => a.prisma.item.count({ where: { isActive: true } }), href: '/masters/items' },
  { words: ['rm', 'material', 'materials'], permission: 'raw_materials.view', what: ['raw material size', 'raw material sizes'], count: (a) => a.prisma.rawMaterial.count({ where: { isActive: true } }), href: '/masters/raw-materials' },
  { words: ['heat', 'heats'], permission: 'heats.view', what: ['active heat', 'active heats'], count: (a) => a.prisma.heat.count({ where: { status: 'ACTIVE' } }), href: '/masters/heats' },
  { words: ['employee', 'employees', 'worker', 'workers', 'staff', 'people', 'manpower'], permission: 'employees.view', what: ['working employee', 'working employees'], count: (a) => a.prisma.employee.count({ where: { status: 'ACTIVE' } }), href: '/hr/employees' },
  { words: ['user', 'users', 'login', 'logins'], permission: 'users.view', what: ['active ERP user', 'active ERP users'], count: (a) => a.prisma.user.count({ where: { isActive: true } }), href: '/admin/users' },
];

export const generalTopics: Topic[] = [
  {
    id: 'count',
    area: 'General',
    label: 'counts',
    permissions: [...new Set(COUNTS.map((c) => c.permission))],
    examples: [
      { q: 'How many customers do we have?', permission: 'customers.view' },
      { q: 'How many employees are working?', permission: 'employees.view' },
      { q: 'How many suppliers do we have?', permission: 'suppliers.view' },
      { q: 'How many parts are there?', permission: 'items.view' },
    ],
    score: (p) => (has(p, 'how many', 'number of', 'count of', 'total number', 'total no') && COUNTS.some((c) => has(p, ...c.words)) && !has(p, 'absent', 'present', 'leave', 'order', 'orders', 'so', 'invoice', 'invoices') ? 6 : 0),
    async answer(ask) {
      const asked = COUNTS.filter((c) => has(ask.p, ...c.words));
      const allowed = asked.filter((c) => ask.can(c.permission));
      if (!allowed.length) return { text: 'You do not have access to that list.' };
      const counts = await Promise.all(allowed.map(async (c) => ({ c, n: await c.count(ask) })));
      return {
        understood: 'Counts',
        text: counts.map(({ c, n }) => `${plural(n, c.what[0], c.what[1])}`).join(', ') + '.',
        links: counts.map(({ c }) => ({ label: c.what[1].replace(/^(active|working) /, '').replace(/^./, (x) => x.toUpperCase()), href: c.href })),
      };
    },
  },
];
