import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { COMMON_WORDS, nameTokens, type Parsed } from './language';

/** Legal words that say nothing about which party is meant. */
const LEGAL = new Set(['pvt', 'private', 'ltd', 'limited', 'llp', 'llc', 'inc', 'co', 'company', 'corporation', 'm', 's', 'ms', 'the', 'and', '&']);
/** Words of part names that carry meaning for matching items. */
const PART_WORDS = new Set(['male', 'female', 'nut', 'bw', 'thd', 'inch', 'fig', 'sub', 'wing', 'union', 'hammer']);
const SHAPES: Record<string, string> = { round: 'ROUND', rd: 'ROUND', square: 'SQUARE', sq: 'SQUARE', sqr: 'SQUARE', pipe: 'PIPE', tube: 'PIPE', hex: 'HEX', flat: 'FLAT', plate: 'PLATE' };

export interface Named {
  id: number;
  name: string;
  /** Lower-case name with single spaces, for "whole name typed" matches. */
  phrase: string;
  tokens: string[];
}
export interface EmployeeRef extends Named {
  code: string;
  departmentId: number | null;
  status: 'ACTIVE' | 'LEFT';
}
export interface MaterialRef {
  id: number;
  code: string;
  grade: string;
  gradeId: number;
  size: string;
  /** Numbers of the size, e.g. 100X100 MM SQUARE -> [100, 100]. */
  nums: number[];
  shape: string;
}
export interface ItemRef extends Named {
  code: string;
  productId: number;
}

interface Data {
  customers: Named[];
  suppliers: Named[];
  employees: EmployeeRef[];
  departments: Named[];
  grades: Named[];
  materials: MaterialRef[];
  products: Named[];
  items: ItemRef[];
  /** Every word of every name, so spelling help never changes a name. */
  nameWords: Set<string>;
}

/** What a question mentions, found by name / code. */
export interface Found {
  customers: Named[];
  suppliers: Named[];
  employees: EmployeeRef[];
  departments: Named[];
  grades: Named[];
  materials: MaterialRef[];
  /** True when the question gave a size or shape (so `materials` is not just "all of the grade"). */
  materialBySize: boolean;
  /** A grade or a bar size was named, even if no such material exists. */
  materialAsked: boolean;
  items: ItemRef[];
  products: Named[];
}

const named = (id: number, name: string): Named => {
  const tokens = nameTokens(name);
  return { id, name, phrase: tokens.join(' '), tokens };
};

/**
 * Names the assistant can recognise in a question (customers, suppliers, employees, materials, parts),
 * read from the database and kept for one minute.
 */
@Injectable()
export class AssistantCatalog {
  private cache: { at: number; data: Data } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async data(): Promise<Data> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.data;
    const [customers, suppliers, employees, departments, grades, materials, products, items] = await Promise.all([
      this.prisma.customer.findMany({ select: { id: true, name: true } }),
      this.prisma.supplier.findMany({ select: { id: true, name: true } }),
      this.prisma.employee.findMany({ select: { id: true, empCode: true, name: true, departmentId: true, status: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
      this.prisma.materialGrade.findMany({ select: { id: true, name: true } }),
      this.prisma.rawMaterial.findMany({ where: { isActive: true }, select: { id: true, code: true, size: true, shape: true, gradeId: true, grade: { select: { name: true } } } }),
      this.prisma.product.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
      this.prisma.item.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, productId: true } }),
    ]);
    const data: Data = {
      customers: customers.map((c) => named(c.id, c.name)),
      suppliers: suppliers.map((s) => named(s.id, s.name)),
      employees: employees.map((e) => ({ ...named(e.id, e.name), code: e.empCode.toLowerCase(), departmentId: e.departmentId, status: e.status })),
      departments: departments.map((d) => named(d.id, d.name)),
      grades: grades.map((g) => named(g.id, g.name)),
      materials: materials.map((m) => ({
        id: m.id,
        code: m.code,
        grade: m.grade.name,
        gradeId: m.gradeId,
        size: m.size,
        // numbers of the size only, not of a code written in it (90 MM ROUND T0222 -> 90)
        nums: nameTokens(m.size).filter((t) => /^\d+(?:\.\d+)?$/.test(t)).map(Number),
        shape: Object.values(SHAPES).find((s) => m.size.toUpperCase().includes(s)) ?? m.shape,
      })),
      products: products.map((p) => named(p.id, p.name)),
      items: items.map((i) => ({ ...named(i.id, i.name), code: i.code.toLowerCase(), productId: i.productId })),
      nameWords: new Set(),
    };
    for (const list of [data.customers, data.suppliers, data.employees, data.departments, data.grades, data.products, data.items]) {
      for (const x of list) for (const t of x.tokens) if (/^[a-z]+$/.test(t)) data.nameWords.add(t);
    }
    this.cache = { at: Date.now(), data };
    return data;
  }

  async nameWords(): Promise<Set<string>> {
    return (await this.data()).nameWords;
  }

  async find(p: Parsed): Promise<Found> {
    const d = await this.data();
    // a grade word with a digit (a105, 4130, ss316) or a plain one that is not an everyday word (ms)
    const gradeWord = (t: string) => p.words.has(t) && (/\d/.test(t) || (t.length >= 2 && !COMMON_WORDS.has(t)));
    const grades = d.grades.filter((g) => g.tokens.some(gradeWord));
    const { materials, bySize, sized } = this.materials(p, d, grades);
    return {
      customers: parties(p, d.customers),
      suppliers: parties(p, d.suppliers),
      employees: this.employees(p, d),
      departments: d.departments.filter((x) => x.tokens.length > 0 && x.tokens.every((t) => p.words.has(t))),
      grades,
      materials,
      materialBySize: bySize,
      materialAsked: grades.length > 0 || sized,
      ...this.parts(p, d),
    };
  }

  /** By code (a number typed alone) or by name: whole name, else first name / surname. */
  private employees(p: Parsed, d: Data): EmployeeRef[] {
    const byCode = d.employees.filter((e) => p.numbers.includes(e.code) || p.codes.includes(e.code));
    if (byCode.length) return byCode;
    const whole = d.employees.filter((e) => e.phrase.length >= 3 && p.padded.includes(` ${e.phrase} `));
    if (whole.length) return whole;
    let best: EmployeeRef[] = [];
    let bestHits = 0;
    for (const e of d.employees) {
      const n = e.tokens.filter((t) => t.length >= 3 && !COMMON_WORDS.has(t) && p.words.has(t)).length;
      if (n > bestHits) [best, bestHits] = [[e], n];
      else if (n === bestHits && n > 0) best.push(e);
    }
    // working employees first when a name is shared
    return best.sort((a, b) => (a.status === b.status ? 0 : a.status === 'ACTIVE' ? -1 : 1));
  }

  /** Grade + size ("4130 90 mm round", "a105 100x100"); a grade alone means all its sizes. */
  private materials(p: Parsed, d: Data, grades: Named[]): { materials: MaterialRef[]; bySize: boolean; sized: boolean } {
    const byCode = d.materials.filter((m) => p.codes.includes(m.code.toLowerCase()));
    if (byCode.length) return { materials: byCode, bySize: true, sized: true };
    const nums = p.numbers.map(Number);
    const shape = Object.entries(SHAPES).find(([w]) => p.words.has(w))?.[1];
    const gradeIds = new Set(grades.map((g) => g.id));
    // numbers that are only the grade (4130, 2830) do not count as a size
    const gradeNums = new Set(grades.flatMap((g) => g.tokens).filter((t) => /^\d+$/.test(t)).map(Number));
    const sizeNums = nums.filter((n) => !gradeNums.has(n));
    const pool = gradeIds.size ? d.materials.filter((m) => gradeIds.has(m.gradeId)) : d.materials;
    // a size counts with a shape or a grade ("90 round", "4130 90"); a bare number is not a bar size
    const sized = !!shape && (sizeNums.length > 0 || gradeIds.size > 0);
    if (sizeNums.length && (shape || gradeIds.size)) {
      const hit = pool.filter((m) => {
        if (shape && m.shape !== shape) return false;
        const left = [...sizeNums];
        return m.nums.length > 0 && m.nums.every((n) => {
          const i = left.indexOf(n);
          if (i < 0) return false;
          left.splice(i, 1);
          return true;
        });
      });
      return { materials: hit, bySize: true, sized: true };
    }
    if (shape && gradeIds.size) return { materials: pool.filter((m) => m.shape === shape), bySize: true, sized };
    return { materials: gradeIds.size ? pool : [], bySize: false, sized };
  }

  /** Parts by figure, size and part ("1502 2 inch male bw"); every word typed must be in the name. */
  private parts(p: Parsed, d: Data): { items: ItemRef[]; products: Named[] } {
    const vocabulary = new Set(d.items.flatMap((i) => i.tokens));
    const asked = [...p.words].filter((w) => vocabulary.has(w) && (PART_WORDS.has(w) || /^\d+$/.test(w)) && w !== 'inch');
    const code = d.items.filter((i) => p.codes.includes(i.code) || p.words.has(i.code));
    if (code.length) return { items: code, products: [] };
    // a figure number is needed: "2 male" alone says too little
    if (!asked.some((w) => /^\d{3,4}$/.test(w))) return { items: [], products: [] };
    const items = d.items.filter((i) => asked.every((w) => i.tokens.includes(w)));
    const products = d.products.filter((x) => asked.filter((w) => /^\d+$/.test(w)).every((w) => x.tokens.includes(w)));
    return { items, products };
  }
}

/** Customers / suppliers: the whole name typed, or its distinctive words (not "steel", "services" ...). */
function parties(p: Parsed, list: Named[]): Named[] {
  const whole = list.filter((x) => x.phrase.length >= 3 && p.padded.includes(` ${x.phrase} `));
  if (whole.length) return whole;
  let best: Named[] = [];
  let bestScore = 0;
  for (const x of list) {
    const words = x.tokens.filter((t) => !LEGAL.has(t));
    const distinctive = words.filter((t) => t.length >= 3 && !COMMON_WORDS.has(t));
    const matched = distinctive.filter((t) => p.words.has(t));
    if (!matched.length) continue;
    const score = matched.length / Math.max(1, distinctive.length);
    if (score > bestScore) [best, bestScore] = [[x], score];
    else if (score === bestScore) best.push(x);
  }
  return bestScore >= 0.5 ? best : [];
}
