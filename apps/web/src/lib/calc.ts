/** The operator keys; an expression is kept with these characters, e.g. "125000×18%". */
export const OPERATORS = ['+', '−', '×', '÷'] as const;

export class CalcError extends Error {}

type Token = number | '+' | '-' | '*' | '/' | '%' | '(' | ')';
const SYMBOLS: Record<string, Token> = { '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', x: '*', '/': '/', '÷': '/', '%': '%', '(': '(', ')': ')' };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  const text = expr.replace(/[\s,]/g, '');
  for (let i = 0; i < text.length; ) {
    const number = /^(\d+\.?\d*|\.\d+)/.exec(text.slice(i));
    if (number) {
      tokens.push(Number(number[0]));
      i += number[0].length;
    } else if (SYMBOLS[text[i]]) {
      tokens.push(SYMBOLS[text[i]]);
      i++;
    } else {
      throw new CalcError('Only numbers and + − × ÷ % ( ) can be used');
    }
  }
  return tokens;
}

/**
 * Works out a calculator expression such as "1,000 + 18%" or "(12.5 − 2) × 4", without eval.
 * A percent after + or − is taken of the number before it (1000 + 18% = 1180, like a desk calculator);
 * after × or ÷ it is a fraction (200 × 10% = 20). Missing closing brackets are added.
 * Returns null while the expression is not complete; throws CalcError on division by zero.
 */
export function evaluate(expr: string): number | null {
  const tokens = tokenize(expr);
  if (!tokens.length) return null;
  let i = 0;
  const incomplete = new CalcError('incomplete');

  const sum = (): number => {
    let left = product().value;
    while (tokens[i] === '+' || tokens[i] === '-') {
      const op = tokens[i++];
      const right = product();
      const value = right.percent ? left * right.value : right.value;
      left = op === '+' ? left + value : left - value;
    }
    return left;
  };
  const product = () => {
    let { value, percent } = factor();
    while (tokens[i] === '*' || tokens[i] === '/') {
      const op = tokens[i++];
      const right = factor().value;
      if (op === '/' && right === 0) throw new CalcError('Cannot divide by zero');
      value = op === '*' ? value * right : value / right;
      percent = false;
    }
    return { value, percent };
  };
  const factor = (): { value: number; percent: boolean } => {
    const token = tokens[i++];
    if (token === '-' || token === '+') {
      const f = factor();
      return { value: token === '-' ? -f.value : f.value, percent: f.percent };
    }
    let value: number;
    if (token === '(') {
      value = sum();
      if (tokens[i] === ')') i++;
    } else if (typeof token === 'number') {
      value = token;
    } else {
      throw incomplete;
    }
    let percent = false;
    while (tokens[i] === '%') {
      i++;
      value /= 100;
      percent = true;
    }
    return { value, percent };
  };

  try {
    const value = sum();
    if (i < tokens.length) return null;
    if (!Number.isFinite(value)) throw new CalcError('The number is too large');
    // 0.1 + 0.2 gives 0.30000000000000004 in binary maths: keep 12 significant digits
    return Number.parseFloat(value.toPrecision(12)) || 0;
  } catch (err) {
    if (err === incomplete) return null;
    throw err;
  }
}

const resultFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 10 });
const plainFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 10, useGrouping: false });

/** 22500.5 -> "22,500.5" (Indian grouping) */
export const fmtResult = (value: number) => resultFmt.format(value);

/** A result as an expression to carry on with: no grouping, no "1e+21", minus sign as on the key. */
export const toExpr = (value: number) => plainFmt.format(value).replace('-', '−');

/** "125000.50×18%" -> "1,25,000.50 × 18%" for the display (decimals as typed). */
export function prettyExpr(expr: string) {
  return expr
    .replace(/\d+/g, (digits, at: number) => (expr[at - 1] === '.' ? digits : BigInt(digits).toLocaleString('en-IN')))
    .replace(/([+×÷]|(?<=[\d.%)])−)/g, ' $1 ');
}
