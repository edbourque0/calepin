/**
 * Formulas for database properties: a small, safe expression language (no eval).
 *
 *   prop("Budget") * 1.15
 *   if(prop("Fait"), "✓", dateBetween(prop("Échéance"), now(), "days") + " j")
 *   concat(upper(prop("Nom")), " — ", prop("Statut"))
 *
 * Values: numbers, text, booleans, dates (Date), lists, null.
 */

export type FValue = number | string | boolean | Date | FValue[] | null;

export class FormulaError extends Error {}

/* ---------- Tokenizer ---------- */

type Token =
  { t: "num"; v: number } | { t: "str"; v: string } | { t: "id"; v: string } | { t: "op"; v: string } | { t: "eof" };

const OPS = ["==", "!=", ">=", "<=", "&&", "||", "+", "-", "*", "/", "%", "^", ">", "<", "!", "(", ")", ",", "?", ":"];

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = src.slice(i).match(/^\d*\.?\d+(e[+-]?\d+)?/i);
      if (!m) throw new FormulaError(`Unexpected "${c}"`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'" || c === "“" || c === "«") {
      const close = c === "“" ? "”" : c === "«" ? "»" : c;
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== close) {
        if (src[j] === "\\" && j + 1 < src.length) {
          s += src[j + 1];
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new FormulaError("Unclosed text: add the closing quote");
      out.push({ t: "str", v: s.trim() === s ? s : s });
      i = j + 1;
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      const m = src.slice(i).match(/^[\p{L}_][\p{L}\p{N}_]*/u)!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new FormulaError(`Unexpected "${c}"`);
    out.push({ t: "op", v: op });
    i += op.length;
  }
  out.push({ t: "eof" });
  return out;
}

/* ---------- Parser (precedence climbing) ---------- */

export type Node =
  | { k: "lit"; v: FValue }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "if"; c: Node; a: Node; b: Node }
  | { k: "call"; name: string; args: Node[] };

const PREC: Record<string, number> = {
  "||": 1,
  or: 1,
  "&&": 2,
  and: 2,
  "==": 3,
  "!=": 3,
  ">": 4,
  "<": 4,
  ">=": 4,
  "<=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
  "^": 7,
};

export function parse(src: string): Node {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos]!;
  const next = () => toks[pos++]!;
  const expectOp = (v: string) => {
    const t = next();
    if (t.t !== "op" || t.v !== v) throw new FormulaError(`Expected "${v}"`);
  };
  const binOp = (t: Token) =>
    t.t === "op" && t.v in PREC ? t.v : t.t === "id" && (t.v === "and" || t.v === "or") ? t.v : null;

  const primary = (): Node => {
    const t = next();
    if (t.t === "num") return { k: "lit", v: t.v };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "op" && t.v === "(") {
      const e = ternary();
      expectOp(")");
      return e;
    }
    if (t.t === "op" && (t.v === "-" || t.v === "!")) return { k: "un", op: t.v, a: unary() };
    if (t.t === "id") {
      if (t.v === "true") return { k: "lit", v: true };
      if (t.v === "false") return { k: "lit", v: false };
      if (t.v === "not") return { k: "un", op: "!", a: unary() };
      if (peek().t === "op" && (peek() as { v: string }).v === "(") {
        next();
        const args: Node[] = [];
        if (!(peek().t === "op" && (peek() as { v: string }).v === ")")) {
          do args.push(ternary());
          while (peek().t === "op" && (peek() as { v: string }).v === "," && next());
        }
        expectOp(")");
        return { k: "call", name: t.v.toLowerCase(), args };
      }
      throw new FormulaError(`Unknown name "${t.v}". Use prop("${t.v}") to read a property`);
    }
    throw new FormulaError(t.t === "eof" ? "The formula ends too early" : `Unexpected "${(t as { v: unknown }).v}"`);
  };
  const unary = (): Node => primary();
  const binary = (min: number): Node => {
    let left = unary();
    for (;;) {
      const op = binOp(peek());
      if (!op || PREC[op]! < min) return left;
      next();
      const right = binary(op === "^" ? PREC[op]! : PREC[op]! + 1);
      left = { k: "bin", op: op === "and" ? "&&" : op === "or" ? "||" : op, a: left, b: right };
    }
  };
  const ternary = (): Node => {
    const c = binary(1);
    if (peek().t === "op" && (peek() as { v: string }).v === "?") {
      next();
      const a = ternary();
      expectOp(":");
      return { k: "if", c, a, b: ternary() };
    }
    return c;
  };
  const tree = ternary();
  if (peek().t !== "eof") throw new FormulaError(`Unexpected "${(peek() as { v: unknown }).v}"`);
  return tree;
}

/* ---------- Evaluation ---------- */

const isDate = (v: FValue): v is Date => v instanceof Date;
const num = (v: FValue): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (isDate(v)) return v.getTime();
  if (v === null || v === "") return 0;
  if (Array.isArray(v)) return v.length;
  const n = Number(String(v).replace(",", "."));
  if (Number.isNaN(n)) throw new FormulaError(`"${v}" is not a number`);
  return n;
};
const truthy = (v: FValue) => !(v === null || v === false || v === 0 || v === "" || (Array.isArray(v) && !v.length));
export const text = (v: FValue): string => {
  if (v === null) return "";
  if (isDate(v)) return dateText(v);
  if (Array.isArray(v)) return v.map(text).join(", ");
  if (typeof v === "number") return String(Math.round(v * 1e10) / 1e10);
  return String(v);
};
const dateText = (d: Date) =>
  d.getUTCHours() || d.getUTCMinutes() ? d.toISOString().slice(0, 16).replace("T", " ") : d.toISOString().slice(0, 10);
const toDate = (v: FValue): Date => {
  if (isDate(v)) return v;
  if (typeof v === "number") return new Date(v);
  const s = text(v);
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  if (Number.isNaN(d.getTime())) throw new FormulaError(`"${s}" is not a date`);
  return d;
};
const UNIT_MS: Record<string, number> = {
  minutes: 60_000,
  minute: 60_000,
  hours: 3_600_000,
  hour: 3_600_000,
  days: 86_400_000,
  day: 86_400_000,
  jours: 86_400_000,
  jour: 86_400_000,
  weeks: 604_800_000,
  week: 604_800_000,
  semaines: 604_800_000,
};
const addTo = (d: Date, n: number, unit: string) => {
  const r = new Date(d);
  const u = unit.toLowerCase();
  if (u.startsWith("month") || u === "mois") r.setUTCMonth(r.getUTCMonth() + n);
  else if (u.startsWith("year") || u.startsWith("an")) r.setUTCFullYear(r.getUTCFullYear() + n);
  else if (UNIT_MS[u]) return new Date(r.getTime() + n * UNIT_MS[u]!);
  else throw new FormulaError(`Unknown unit "${unit}" (days, weeks, months, years, hours, minutes)`);
  return r;
};

function equals(a: FValue, b: FValue): boolean {
  if (isDate(a) || isDate(b)) {
    try {
      return toDate(a).getTime() === toDate(b).getTime();
    } catch {
      return false;
    }
  }
  if (typeof a === "number" || typeof b === "number") {
    try {
      return num(a) === num(b);
    } catch {
      return false;
    }
  }
  return text(a) === text(b);
}

type Ctx = { prop: (name: string) => FValue; now: Date };

const FUNCTIONS: Record<string, (args: FValue[], ctx: Ctx) => FValue> = {
  prop: ([n], ctx) => ctx.prop(text(n ?? "")),
  if: ([c, a, b]) => (truthy(c ?? null) ? (a ?? null) : (b ?? null)),
  and: (args) => args.every(truthy),
  or: (args) => args.some(truthy),
  not: ([a]) => !truthy(a ?? null),
  empty: ([a]) => !truthy(a ?? null) && a !== 0 && a !== false,
  // text
  concat: (args) => args.map(text).join(""),
  length: ([a]) => (Array.isArray(a) ? a.length : text(a ?? null).length),
  lower: ([a]) => text(a ?? null).toLowerCase(),
  upper: ([a]) => text(a ?? null).toUpperCase(),
  trim: ([a]) => text(a ?? null).trim(),
  contains: ([a, b]) =>
    Array.isArray(a)
      ? a.some((x) => equals(x, b ?? null))
      : text(a ?? null)
          .toLowerCase()
          .includes(text(b ?? null).toLowerCase()),
  replace: ([s, a, b]) =>
    text(s ?? null)
      .split(text(a ?? null))
      .join(text(b ?? null)),
  slice: ([s, a, b]) => text(s ?? null).slice(num(a ?? 0), b === undefined ? undefined : num(b)),
  join: ([list, sep]) =>
    Array.isArray(list) ? list.map(text).join(sep === undefined ? ", " : text(sep)) : text(list ?? null),
  format: ([a]) => text(a ?? null),
  tonumber: ([a]) => num(a ?? null),
  // numbers
  round: ([a, d]) => {
    const f = 10 ** num(d ?? 0);
    return Math.round(num(a ?? null) * f) / f;
  },
  floor: ([a]) => Math.floor(num(a ?? null)),
  ceil: ([a]) => Math.ceil(num(a ?? null)),
  abs: ([a]) => Math.abs(num(a ?? null)),
  sqrt: ([a]) => Math.sqrt(num(a ?? null)),
  pow: ([a, b]) => num(a ?? null) ** num(b ?? null),
  min: (args) => Math.min(...args.flat().map(num)),
  max: (args) => Math.max(...args.flat().map(num)),
  sum: (args) => args.flat().reduce<number>((s, v) => s + num(v), 0),
  average: (args) => {
    const l = args.flat();
    return l.length ? l.reduce<number>((s, v) => s + num(v), 0) / l.length : null;
  },
  // dates
  now: (_a, ctx) => ctx.now,
  today: (_a, ctx) => new Date(`${ctx.now.toISOString().slice(0, 10)}T00:00:00Z`),
  date: ([a]) => toDate(a ?? null),
  dateadd: ([d, n, u]) => addTo(toDate(d ?? null), num(n ?? 0), text(u ?? "days")),
  datesubtract: ([d, n, u]) => addTo(toDate(d ?? null), -num(n ?? 0), text(u ?? "days")),
  datebetween: ([a, b, u]) => {
    const unit = text(u ?? "days").toLowerCase();
    const da = toDate(a ?? null);
    const db = toDate(b ?? null);
    if (unit.startsWith("month") || unit === "mois")
      return (da.getUTCFullYear() - db.getUTCFullYear()) * 12 + da.getUTCMonth() - db.getUTCMonth();
    if (unit.startsWith("year") || unit.startsWith("an")) return da.getUTCFullYear() - db.getUTCFullYear();
    const ms = UNIT_MS[unit];
    if (!ms) throw new FormulaError(`Unknown unit "${unit}"`);
    return Math.trunc((da.getTime() - db.getTime()) / ms);
  },
  formatdate: ([d, p]) => {
    const date = toDate(d ?? null);
    const pad = (n: number) => String(n).padStart(2, "0");
    return text(p ?? "YYYY-MM-DD")
      .replace("YYYY", String(date.getUTCFullYear()))
      .replace("MM", pad(date.getUTCMonth() + 1))
      .replace("DD", pad(date.getUTCDate()))
      .replace("HH", pad(date.getUTCHours()))
      .replace("mm", pad(date.getUTCMinutes()));
  },
  year: ([d]) => toDate(d ?? null).getUTCFullYear(),
  month: ([d]) => toDate(d ?? null).getUTCMonth() + 1,
  day: ([d]) => toDate(d ?? null).getUTCDate(),
  weekday: ([d]) => toDate(d ?? null).getUTCDay(),
};

// Date functions on an empty value give an empty result instead of an error.
const blank = (v: FValue | undefined) => v === null || v === undefined || v === "";
for (const name of [
  "date",
  "dateadd",
  "datesubtract",
  "datebetween",
  "formatdate",
  "year",
  "month",
  "day",
  "weekday",
]) {
  const fn = FUNCTIONS[name]!;
  const arity = name === "datebetween" ? 2 : 1;
  FUNCTIONS[name] = (args, ctx) => (args.slice(0, arity).some(blank) ? null : fn(args, ctx));
}

export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

function evaluate(node: Node, ctx: Ctx): FValue {
  switch (node.k) {
    case "lit":
      return node.v;
    case "if":
      return truthy(evaluate(node.c, ctx)) ? evaluate(node.a, ctx) : evaluate(node.b, ctx);
    case "un": {
      const a = evaluate(node.a, ctx);
      return node.op === "-" ? -num(a) : !truthy(a);
    }
    case "bin": {
      if (node.op === "&&") return truthy(evaluate(node.a, ctx)) && truthy(evaluate(node.b, ctx));
      if (node.op === "||") return truthy(evaluate(node.a, ctx)) || truthy(evaluate(node.b, ctx));
      const a = evaluate(node.a, ctx);
      const b = evaluate(node.b, ctx);
      switch (node.op) {
        case "+":
          if (isDate(a) && typeof b === "number") return new Date(a.getTime() + b * 86_400_000);
          return typeof a === "string" || typeof b === "string" || Array.isArray(a) || Array.isArray(b)
            ? text(a) + text(b)
            : num(a) + num(b);
        case "-":
          if (isDate(a) && isDate(b)) return Math.trunc((a.getTime() - b.getTime()) / 86_400_000);
          if (isDate(a)) return new Date(a.getTime() - num(b) * 86_400_000);
          return num(a) - num(b);
        case "*":
          return num(a) * num(b);
        case "/": {
          const d = num(b);
          if (d === 0) throw new FormulaError("Division by zero");
          return num(a) / d;
        }
        case "%":
          return num(a) % num(b);
        case "^":
          return num(a) ** num(b);
        case "==":
          return equals(a, b);
        case "!=":
          return !equals(a, b);
        case ">":
        case "<":
        case ">=":
        case "<=": {
          if (a === null || b === null) return false;
          const x = typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : num(a) - num(b);
          return node.op === ">" ? x > 0 : node.op === "<" ? x < 0 : node.op === ">=" ? x >= 0 : x <= 0;
        }
      }
      throw new FormulaError(`Unknown operator ${node.op}`);
    }
    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new FormulaError(`Unknown function ${node.name}()`);
      // if() evaluates lazily so the unused branch can't fail.
      if (node.name === "if")
        return truthy(evaluate(node.args[0]!, ctx))
          ? evaluate(node.args[1]!, ctx)
          : evaluate(node.args[2] ?? { k: "lit", v: null }, ctx);
      return fn(
        node.args.map((a) => evaluate(a, ctx)),
        ctx,
      );
    }
  }
}

const cache = new Map<string, Node | FormulaError>();

export function compile(src: string): Node {
  let hit = cache.get(src);
  if (!hit) {
    try {
      hit = parse(src);
    } catch (e) {
      hit = e instanceof FormulaError ? e : new FormulaError(String(e));
    }
    if (cache.size > 500) cache.clear();
    cache.set(src, hit);
  }
  if (hit instanceof FormulaError) throw hit;
  return hit;
}

/** Result stored in a row: plain JSON (dates become ISO strings) or an error. */
export type FormulaResult = number | string | boolean | null | (number | string | boolean | null)[] | { error: string };

export function run(src: string, prop: (name: string) => FValue, now = new Date()): FormulaResult {
  if (!src.trim()) return null;
  try {
    const v = evaluate(compile(src), { prop, now });
    const out = (x: FValue): number | string | boolean | null =>
      isDate(x)
        ? dateText(x)
        : typeof x === "number"
          ? Number.isFinite(x)
            ? Math.round(x * 1e10) / 1e10
            : null
          : Array.isArray(x)
            ? text(x)
            : x;
    return Array.isArray(v) ? v.map(out) : out(v);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
