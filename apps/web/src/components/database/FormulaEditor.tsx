import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { api, type DatabaseData } from "@/lib/api";
import { isFormulaError } from "@/lib/database";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PropertyIcon } from "./cells";

const FUNCTIONS: { name: string; snippet: string; group: "logic" | "text" | "number" | "date" }[] = [
  { name: "if", snippet: "if(condition, then, else)", group: "logic" },
  { name: "and / or / not", snippet: "and(a, b)", group: "logic" },
  { name: "empty", snippet: "empty(value)", group: "logic" },
  { name: "concat", snippet: 'concat(a, " ", b)', group: "text" },
  { name: "length", snippet: "length(text)", group: "text" },
  { name: "contains", snippet: 'contains(text, "…")', group: "text" },
  { name: "replace", snippet: 'replace(text, "a", "b")', group: "text" },
  { name: "upper / lower", snippet: "upper(text)", group: "text" },
  { name: "slice", snippet: "slice(text, 0, 10)", group: "text" },
  { name: "join", snippet: 'join(list, ", ")', group: "text" },
  { name: "round", snippet: "round(number, 2)", group: "number" },
  { name: "floor / ceil / abs", snippet: "floor(number)", group: "number" },
  { name: "min / max", snippet: "max(a, b)", group: "number" },
  { name: "sum / average", snippet: "sum(a, b, c)", group: "number" },
  { name: "toNumber", snippet: "toNumber(text)", group: "number" },
  { name: "now / today", snippet: "today()", group: "date" },
  { name: "dateAdd", snippet: 'dateAdd(date, 7, "days")', group: "date" },
  { name: "dateSubtract", snippet: 'dateSubtract(date, 1, "months")', group: "date" },
  { name: "dateBetween", snippet: 'dateBetween(date, today(), "days")', group: "date" },
  { name: "formatDate", snippet: 'formatDate(date, "DD/MM/YYYY")', group: "date" },
  { name: "year / month / day", snippet: "year(date)", group: "date" },
];

type Preview = { error: string | null; results: { id: string; title: string; value: unknown }[] };

/** Expression editor with property and function pickers, and a live preview on the first rows. */
export function FormulaEditor({
  data,
  propertyId,
  initial,
  onSave,
  saving,
  submitLabel,
}: {
  data: DatabaseData;
  propertyId?: string;
  initial: string;
  onSave: (expression: string) => void;
  saving?: boolean;
  submitLabel: string;
}) {
  const { t } = useI18n();
  const [expr, setExpr] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(expr), 300);
    return () => clearTimeout(h);
  }, [expr]);

  const preview = useQuery({
    queryKey: ["formula-preview", data.database.id, propertyId, debounced],
    queryFn: () =>
      api.post<Preview>(`/databases/${data.database.id}/formula-preview`, { expression: debounced, propertyId }),
    enabled: debounced.trim().length > 0,
    placeholderData: (prev) => prev,
  });

  const insert = (text: string) => {
    const el = area.current;
    if (!el) return setExpr((e) => e + text);
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = expr.slice(0, start) + text + expr.slice(end);
    setExpr(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const props = data.properties.filter((p) => p.id !== propertyId);
  const error = expr.trim() ? preview.data?.error : null;

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={area}
        autoFocus
        value={expr}
        onChange={(e) => setExpr(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!error) onSave(expr);
          }
        }}
        spellCheck={false}
        rows={3}
        placeholder={'prop("Budget") * 1.15'}
        aria-label={t("db.formula")}
        className="min-h-20 resize-y rounded-md border border-input bg-background px-2.5 py-2 font-mono text-[13px] leading-relaxed shadow-xs placeholder:text-muted-foreground"
      />
      <div className="min-h-5 text-xs">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : expr.trim() && preview.data?.results.length ? (
          <ul className="flex flex-col gap-0.5">
            {preview.data.results.map((r) => (
              <li key={r.id} className="flex min-w-0 gap-2">
                <span className="w-24 shrink-0 truncate text-muted-foreground">{r.title || t("page.untitled")}</span>
                <span className={cn("truncate font-mono", isFormulaError(r.value) && "text-destructive")}>
                  {isFormulaError(r.value)
                    ? r.value.error
                    : r.value === null
                      ? "—"
                      : Array.isArray(r.value)
                        ? r.value.join(", ")
                        : String(r.value)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground">{t("db.formulaHint")}</span>
        )}
      </div>
      <div className="grid max-h-56 grid-cols-2 gap-x-2 overflow-y-auto border-t border-border pt-2">
        <div className="flex flex-col">
          <span className="caps-label px-1 pb-1">{t("db.properties")}</span>
          <button
            type="button"
            onClick={() => insert('prop("title")')}
            className="flex h-7 items-center gap-1.5 rounded-sm px-1 text-left text-[13px] hover:bg-accent [&_svg]:text-muted-foreground"
          >
            <PropertyIcon type="title" />
            <span className="truncate">{t("db.titleColumn")}</span>
          </button>
          {props.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => insert(`prop("${p.name.replace(/"/g, '\\"')}")`)}
              className="flex h-7 items-center gap-1.5 rounded-sm px-1 text-left text-[13px] hover:bg-accent [&_svg]:text-muted-foreground"
            >
              <PropertyIcon type={p.type} />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col">
          <span className="caps-label px-1 pb-1">{t("db.functions")}</span>
          {FUNCTIONS.map((f) => (
            <button
              type="button"
              key={f.name}
              title={f.snippet}
              onClick={() => insert(f.snippet)}
              className="flex h-7 items-center rounded-sm px-1 text-left font-mono text-[12px] hover:bg-accent"
            >
              <span className="truncate">{f.name}</span>
            </button>
          ))}
        </div>
      </div>
      <Button type="button" size="sm" disabled={!!error || saving} onClick={() => onSave(expr)}>
        {submitLabel}
      </Button>
    </div>
  );
}
