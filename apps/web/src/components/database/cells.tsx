import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  AtSign,
  Calendar,
  Check,
  CircleDot,
  Clock,
  FileText,
  SquareFunction,
  Hash,
  Link2,
  List,
  ListChecks,
  Mail,
  Phone,
  Plus,
  Sigma,
  SquareCheck,
  Tags,
  Text,
  User,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Popover } from "@/components/ui";
import {
  api,
  type DatabaseData,
  type LinkedRow,
  type Property,
  type PropertyType,
  type Row,
  type SelectOption,
  type TagColor,
} from "@/lib/api";
import { formatDate, formatNumber, isFormulaError, optionFor, propertyOptions, READ_ONLY_TYPES } from "@/lib/database";
import { localeOf, useI18n } from "@/lib/i18n";
import { cn, colorFor, initials } from "@/lib/utils";
import { PageIcon } from "@/components/PageIcon";

export const TAG_COLORS: TagColor[] = ["gray", "amber", "green", "blue", "rose"];
const newId = () => Math.random().toString(36).slice(2, 10);

export function PropertyIcon({ type, className }: { type: PropertyType | "title"; className?: string }) {
  const Icon =
    {
      title: FileText,
      text: Text,
      number: Hash,
      select: CircleDot,
      multi_select: Tags,
      status: ListChecks,
      date: Calendar,
      checkbox: SquareCheck,
      url: Link2,
      email: Mail,
      phone: Phone,
      person: User,
      relation: ArrowUpRight,
      rollup: Sigma,
      formula: SquareFunction,
      created_time: Clock,
      last_edited_time: Clock,
    }[type] ?? List;
  return <Icon className={cn("size-[13px] shrink-0", className)} />;
}

export function Tag({ option, onRemove }: { option: SelectOption; onRemove?: () => void }) {
  return (
    <span className={cn("tag", `tag-${option.color}`)}>
      <span className="truncate">{option.name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-0.5 inline-flex rounded-[3px] opacity-70 hover:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

export function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border align-middle",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

function PersonChip({ id, name }: { id: string; name: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] bg-muted text-[8px] font-semibold"
        style={{ borderColor: colorFor(id) }}
      >
        {initials(name)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/* ---------- Read-only display ---------- */

export function CellValue({ prop, row, data }: { prop: Property; row: Row; data: DatabaseData }) {
  const { lang } = useI18n();
  const locale = localeOf(lang);
  const v = row.props[prop.id];
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) {
    if (prop.type === "checkbox") return <Checkbox checked={false} />;
    return null;
  }
  switch (prop.type) {
    case "number":
      return <span className="block text-right tabular-nums">{formatNumber(prop, v, locale)}</span>;
    case "select":
    case "status": {
      const o = optionFor(prop, v);
      return o ? <Tag option={o} /> : null;
    }
    case "multi_select":
      return (
        <span className="flex flex-wrap gap-1">
          {(v as string[]).map((id) => {
            const o = optionFor(prop, id);
            return o ? <Tag key={id} option={o} /> : null;
          })}
        </span>
      );
    case "checkbox":
      return <Checkbox checked={v === true} />;
    case "date":
      return <span>{formatDate(v, locale)}</span>;
    case "created_time":
    case "last_edited_time":
      return <span className="text-muted-foreground">{formatDate(v, locale, true)}</span>;
    case "url":
      return (
        <a
          href={/^https?:\/\//.test(String(v)) ? String(v) : `https://${v}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="truncate underline decoration-input underline-offset-4 hover:decoration-foreground"
        >
          {String(v).replace(/^https?:\/\//, "")}
        </a>
      );
    case "email":
      return (
        <a
          href={`mailto:${v}`}
          onClick={(e) => e.stopPropagation()}
          className="truncate underline decoration-input underline-offset-4"
        >
          {String(v)}
        </a>
      );
    case "person":
      return (
        <span className="flex flex-wrap gap-x-2 gap-y-1">
          {(v as string[]).map((id) => (
            <PersonChip key={id} id={id} name={data.people.find((p) => p.id === id)?.name ?? "?"} />
          ))}
        </span>
      );
    case "relation":
      return (
        <span className="flex flex-wrap gap-1">
          {(v as LinkedRow[]).map((r) => (
            <Link
              key={r.id}
              to={`/p/${r.id}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex max-w-full items-center gap-1 rounded-sm px-1 underline decoration-input underline-offset-4 hover:bg-accent"
            >
              <PageIcon icon={r.icon} size={12} />
              <span className="truncate">{r.title || "—"}</span>
            </Link>
          ))}
        </span>
      );
    case "formula":
      if (isFormulaError(v))
        return (
          <span className="truncate text-xs text-destructive" title={v.error}>
            ⚠ {v.error}
          </span>
        );
      if (typeof v === "boolean") return <Checkbox checked={v} />;
      if (typeof v === "number")
        return (
          <span className="block text-right tabular-nums">
            {new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(v)}
          </span>
        );
      if (Array.isArray(v)) return <span className="truncate">{v.join(", ")}</span>;
      return (
        <span className="truncate">
          {/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(String(v))
            ? formatDate(String(v).replace(" ", "T"), locale, String(v).length > 10)
            : String(v)}
        </span>
      );
    case "rollup":
      if (typeof v === "number")
        return (
          <span className="block text-right tabular-nums">
            {prop.config.fn === "percent_checked"
              ? new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(v)
              : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v)}
          </span>
        );
      if (Array.isArray(v))
        return (
          <span className="flex flex-wrap gap-1">
            {v.map((x, i) => (
              <span key={i} className="tag tag-gray">
                {String(x)}
              </span>
            ))}
          </span>
        );
      return <span>{/^\d{4}-\d{2}-\d{2}/.test(String(v)) ? formatDate(v, locale) : String(v)}</span>;
    default:
      return <span className="truncate">{String(v)}</span>;
  }
}

/* ---------- Editing ---------- */

type EditProps = {
  prop: Property;
  row: Row;
  data: DatabaseData;
  canEdit: boolean;
  onChange: (value: unknown) => void;
  /** Adds an option to a select property; resolves once the server has it. */
  onAddOption: (prop: Property, option: SelectOption) => Promise<unknown>;
  className?: string;
  /** "cell" in tables and boards, "field" on a row page. */
  variant?: "cell" | "field";
};

/** A value that turns into the right editor when clicked. */
export function EditableValue(props: EditProps) {
  const { prop, row, data, canEdit, onChange, className, variant = "cell" } = props;
  const [editing, setEditing] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const readOnly = !canEdit || READ_ONLY_TYPES.includes(prop.type);
  const v = row.props[prop.id];
  const inline = ["text", "number", "url", "email", "phone", "date"].includes(prop.type);
  const popover = ["select", "status", "multi_select", "person", "relation"].includes(prop.type);

  const start = () => {
    if (readOnly) return;
    if (prop.type === "checkbox") return onChange(!(v === true));
    setEditing(true);
  };

  const base = cn(
    "relative flex min-h-9 w-full min-w-0 items-center",
    variant === "cell" ? "px-2 py-1.5" : "rounded-sm px-2 py-1 hover:bg-accent",
    !readOnly && "cursor-pointer",
    className,
  );

  if (editing && inline)
    return (
      <div className={cn(base, "p-0")}>
        <InlineInput
          prop={prop}
          value={v}
          onDone={(next) => {
            setEditing(false);
            if (next !== undefined) onChange(next);
          }}
        />
      </div>
    );

  return (
    <>
      <div
        ref={anchor}
        role={readOnly ? undefined : "button"}
        tabIndex={readOnly ? undefined : 0}
        onClick={start}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === e.currentTarget) start();
        }}
        className={base}
      >
        <CellValue prop={prop} row={row} data={data} />
        {variant === "field" &&
          (v === null || v === undefined || (Array.isArray(v) && !v.length)) &&
          prop.type !== "checkbox" && <EmptyHint readOnly={readOnly} />}
      </div>
      {popover && (
        <Popover anchor={anchor} open={editing} onClose={() => setEditing(false)} className="w-72 p-0">
          {prop.type === "relation" ? (
            <RelationPicker prop={prop} value={(v as LinkedRow[]) ?? []} onChange={onChange} />
          ) : prop.type === "person" ? (
            <PersonPicker data={data} value={(v as string[]) ?? []} onChange={onChange} />
          ) : (
            <OptionPicker {...props} />
          )}
        </Popover>
      )}
    </>
  );
}

function EmptyHint({ readOnly }: { readOnly: boolean }) {
  const { t } = useI18n();
  return <span className="text-muted-foreground">{readOnly ? "—" : t("db.empty")}</span>;
}

function InlineInput({ prop, value, onDone }: { prop: Property; value: unknown; onDone: (v: unknown) => void }) {
  const initial =
    value === null || value === undefined ? "" : String(value).slice(0, prop.type === "date" ? 10 : undefined);
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (!save || text === initial) return onDone(undefined);
    if (prop.type === "number") {
      const n = Number(text.replace(",", ".").replace(/\s/g, ""));
      return onDone(text.trim() === "" ? null : Number.isFinite(n) ? n : undefined);
    }
    onDone(text.trim() === "" ? null : text);
  };
  return (
    <input
      autoFocus
      type={prop.type === "date" ? "date" : prop.type === "email" ? "email" : "text"}
      inputMode={prop.type === "number" ? "decimal" : undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      className={cn(
        "h-9 w-full min-w-0 rounded-[2px] bg-popover px-2 text-sm outline-2 outline-ring",
        prop.type === "number" && "text-right tabular-nums",
      )}
    />
  );
}

function OptionPicker({ prop, row, onChange, onAddOption }: EditProps) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const multi = prop.type === "multi_select";
  const current = row.props[prop.id];
  const selected: string[] = multi ? ((current as string[]) ?? []) : current ? [current as string] : [];
  const opts = propertyOptions(prop);
  const shown = opts.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = opts.some((o) => o.name.toLowerCase() === q.trim().toLowerCase());

  const toggle = (id: string) => {
    if (multi) onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else onChange(selected[0] === id ? null : id);
    setQ("");
  };
  const [creating, setCreating] = useState(false);
  const create = async () => {
    const name = q.trim();
    if (!name || creating) return;
    const option: SelectOption = { id: newId(), name, color: TAG_COLORS[opts.length % TAG_COLORS.length]! };
    setCreating(true);
    try {
      // The option must exist on the server before a row points to it; otherwise the server would
      // take the unknown id for a new option's name.
      await onAddOption(prop, option);
      toggle(option.id);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-border p-2">
        {selected.map((id) => {
          const o = optionFor(prop, id);
          return o ? <Tag key={id} option={o} onRemove={() => toggle(id)} /> : null;
        })}
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && q.trim()) {
              const match = shown[0];
              if (exact || (match && shown.length === 1)) toggle(match!.id);
              else create();
            }
            if (e.key === "Backspace" && !q && selected.length) toggle(selected.at(-1)!);
          }}
          placeholder={t("db.searchOrCreate")}
          className="h-7 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {shown.map((o) => (
          <button
            key={o.id}
            onClick={() => toggle(o.id)}
            className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-accent"
          >
            <Tag option={o} />
            <span className="flex-1" />
            {selected.includes(o.id) && <Check className="size-4" />}
          </button>
        ))}
        {q.trim() && !exact && (
          <button
            onClick={create}
            className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent"
          >
            <Plus className="size-4 text-muted-foreground" />
            {t("db.createOption", { q: q.trim() })}
          </button>
        )}
        {!shown.length && !q.trim() && (
          <div className="px-2 py-2 text-sm text-muted-foreground">{t("db.noOptions")}</div>
        )}
      </div>
    </div>
  );
}

function PersonPicker({
  data,
  value,
  onChange,
}: {
  data: DatabaseData;
  value: string[];
  onChange: (v: unknown) => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const shown = data.people.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2">
        <AtSign className="size-4 text-muted-foreground" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search.placeholder")}
          className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {shown.map((p) => {
          const on = value.includes(p.id);
          return (
            <button
              key={p.id}
              onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
              className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent"
            >
              <PersonChip id={p.id} name={p.name} />
              <span className="flex-1" />
              {on && <Check className="size-4" />}
            </button>
          );
        })}
        {!shown.length && <div className="px-2 py-2 text-sm text-muted-foreground">{t("db.noPeople")}</div>}
      </div>
    </div>
  );
}

function RelationPicker({
  prop,
  value,
  onChange,
}: {
  prop: Property;
  value: LinkedRow[];
  onChange: (v: unknown) => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const target = prop.config.databaseId!;
  const { data } = useQuery({
    queryKey: ["db-options", target],
    queryFn: () => api.get<LinkedRow[]>(`/databases/${target}/options`),
  });
  const ids = value.map((v) => v.id);
  const shown = useMemo(
    () => (data ?? []).filter((r) => (r.title || "").toLowerCase().includes(q.toLowerCase())).slice(0, 100),
    [data, q],
  );
  const set = (next: string[]) => onChange(next);
  return (
    <div className="flex flex-col">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-border p-2">
          {value.map((r) => (
            <span key={r.id} className="tag tag-gray">
              <span className="truncate">{r.title || t("page.untitled")}</span>
              <button
                aria-label="Remove"
                onClick={() => set(ids.filter((x) => x !== r.id))}
                className="opacity-70 hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("db.searchRows")}
        className="h-10 border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <div className="max-h-64 overflow-y-auto p-1">
        {!data && <div className="px-2 py-2 text-sm text-muted-foreground">…</div>}
        {shown.map((r) => {
          const on = ids.includes(r.id);
          return (
            <button
              key={r.id}
              onClick={() => set(on ? ids.filter((x) => x !== r.id) : [...ids, r.id])}
              className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent"
            >
              <PageIcon icon={r.icon} size={16} />
              <span className="flex-1 truncate">{r.title || t("page.untitled")}</span>
              {on && <Check className="size-4" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Title cell ---------- */

export function TitleCell({
  row,
  canEdit,
  onRename,
  autoEdit,
  children,
}: {
  row: Row;
  canEdit: boolean;
  onRename: (title: string) => void;
  autoEdit?: boolean;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(!!autoEdit);
  const [text, setText] = useState(row.title);
  useEffect(() => {
    if (!editing) setText(row.title);
  }, [row.title, editing]);
  const finish = (save: boolean) => {
    setEditing(false);
    if (save && text.trim() !== row.title) onRename(text.trim());
  };
  if (editing)
    return (
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
        }}
        className="h-9 w-full rounded-[2px] bg-popover px-2 text-sm font-medium outline-2 outline-ring"
      />
    );
  return (
    <div className="group/title flex min-h-9 items-center gap-1.5 px-2">
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        <PageIcon icon={row.icon} size={14} />
      </span>
      <span
        role={canEdit ? "button" : undefined}
        tabIndex={canEdit ? 0 : undefined}
        onClick={() => canEdit && setEditing(true)}
        onKeyDown={(e) => e.key === "Enter" && canEdit && setEditing(true)}
        className={cn("min-w-0 flex-1 truncate font-medium", !row.title && "text-muted-foreground")}
      >
        {row.title || t("page.untitled")}
      </span>
      <Link
        to={`/p/${row.id}`}
        className="flex h-6 shrink-0 items-center gap-1 rounded-sm border border-border bg-background px-1.5 text-xs font-medium text-muted-foreground opacity-0 shadow-xs transition-opacity group-hover/title:opacity-100 hover:text-foreground focus-visible:opacity-100 max-md:opacity-100"
      >
        <ArrowUpRight className="size-3.5" />
        {t("db.open")}
      </Link>
      {children}
    </div>
  );
}
