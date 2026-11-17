import type { Property, Row } from "./api";
import { formatDate, formatNumber, isFormulaError, textOf } from "./database";

/** Column totals shown under a table view, like Notion's "Calculate" row. */
export type CalcFn =
  | "count_all"
  | "count_values"
  | "count_empty"
  | "count_unique"
  | "percent_empty"
  | "percent_not_empty"
  | "sum"
  | "average"
  | "median"
  | "min"
  | "max"
  | "range"
  | "earliest"
  | "latest"
  | "date_range"
  | "checked"
  | "unchecked"
  | "percent_checked"
  | "percent_unchecked";

const COUNTS: CalcFn[] = [
  "count_all",
  "count_values",
  "count_empty",
  "count_unique",
  "percent_empty",
  "percent_not_empty",
];
const NUMBERS: CalcFn[] = ["sum", "average", "median", "min", "max", "range"];
const DATES: CalcFn[] = ["earliest", "latest", "date_range"];
const CHECKS: CalcFn[] = ["checked", "unchecked", "percent_checked", "percent_unchecked"];

const DATE_TYPES = ["date", "created_time", "last_edited_time"];

/** Raw value of a cell for calculations (formula errors count as empty). */
function raw(p: Property | "title", row: Row): unknown {
  if (p === "title") return row.title;
  const v = row.props[p.id];
  return isFormulaError(v) ? null : v;
}
const empty = (v: unknown) =>
  v === null || v === undefined || v === "" || v === false || (Array.isArray(v) && v.length === 0);

/** Whether a column holds numbers in these rows (number, or a formula / rollup that returns numbers). */
const numeric = (p: Property | "title", rows: Row[]) =>
  p !== "title" &&
  (p.type === "number" ||
    ((p.type === "formula" || p.type === "rollup") && rows.some((r) => typeof raw(p, r) === "number")));
const dates = (p: Property | "title", rows: Row[]) =>
  p !== "title" &&
  (DATE_TYPES.includes(p.type) ||
    (p.type === "formula" && rows.some((r) => /^\d{4}-\d{2}-\d{2}/.test(String(raw(p, r) ?? "")))));

/** Calculations that make sense for a column, in menu order. */
export function calcsFor(p: Property | "title", rows: Row[]): CalcFn[][] {
  const groups: CalcFn[][] = [COUNTS];
  if (
    p !== "title" &&
    (p.type === "checkbox" || (p.type === "formula" && rows.some((r) => typeof raw(p, r) === "boolean")))
  )
    return [["count_all"], CHECKS];
  if (numeric(p, rows)) groups.push(NUMBERS);
  if (dates(p, rows)) groups.push(DATES);
  return groups;
}

const DAY = 86_400_000;
const toTime = (v: unknown) => {
  const s = String(v);
  const t = new Date(s.length === 10 ? `${s}T00:00:00` : s.replace(" ", "T")).getTime();
  return Number.isNaN(t) ? null : t;
};

/** Computes a calculation and formats it for display. */
export function calculate(fn: CalcFn, p: Property | "title", rows: Row[], locale: string): string {
  const values = rows.map((r) => raw(p, r));
  const n = rows.length;
  const filled = values.filter((v) => !empty(v));
  const pct = (x: number) =>
    new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(n ? x / n : 0);
  const int = (x: number) => new Intl.NumberFormat(locale).format(x);
  const num = (x: number) =>
    p !== "title" && p.type === "number"
      ? formatNumber(p, x, locale)
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(x);

  switch (fn) {
    case "count_all":
      return int(n);
    case "count_values":
      // Lists count each item, like Notion.
      return int(values.reduce<number>((s, v) => s + (Array.isArray(v) ? v.length : empty(v) ? 0 : 1), 0));
    case "count_empty":
      return int(n - filled.length);
    case "count_unique": {
      const seen = new Set<string>();
      for (const r of rows) {
        const v = raw(p, r);
        if (empty(v)) continue;
        if (Array.isArray(v)) for (const x of v) seen.add(typeof x === "object" ? JSON.stringify(x) : String(x));
        else seen.add(p === "title" ? String(v) : textOf(p, r));
      }
      return int(seen.size);
    }
    case "percent_empty":
      return pct(n - filled.length);
    case "percent_not_empty":
      return pct(filled.length);
    case "checked":
      return int(values.filter((v) => v === true).length);
    case "unchecked":
      return int(values.filter((v) => v !== true).length);
    case "percent_checked":
      return pct(values.filter((v) => v === true).length);
    case "percent_unchecked":
      return pct(values.filter((v) => v !== true).length);
  }

  if (NUMBERS.includes(fn)) {
    const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!nums.length) return "—";
    const sorted = [...nums].sort((a, b) => a - b);
    const sum = nums.reduce((s, x) => s + x, 0);
    const mid = Math.floor(sorted.length / 2);
    const value =
      fn === "sum"
        ? sum
        : fn === "average"
          ? sum / nums.length
          : fn === "median"
            ? sorted.length % 2
              ? sorted[mid]!
              : (sorted[mid - 1]! + sorted[mid]!) / 2
            : fn === "min"
              ? sorted[0]!
              : fn === "max"
                ? sorted.at(-1)!
                : sorted.at(-1)! - sorted[0]!;
    return num(value);
  }

  // Dates
  const times = values
    .map((v) => ({ v, t: toTime(v) }))
    .filter((x): x is { v: unknown; t: number } => !empty(x.v) && x.t !== null)
    .sort((a, b) => a.t - b.t);
  if (!times.length) return "—";
  if (fn === "earliest") return formatDate(String(times[0]!.v).replace(" ", "T"), locale);
  if (fn === "latest") return formatDate(String(times.at(-1)!.v).replace(" ", "T"), locale);
  const days = Math.round((times.at(-1)!.t - times[0]!.t) / DAY);
  return new Intl.NumberFormat(locale, { style: "unit", unit: "day", unitDisplay: "long" }).format(days);
}
