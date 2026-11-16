import {
  type ButtonHTMLAttributes,
  forwardRef,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn, colorFor, initials } from "@/lib/utils";

/* ---------- Buttons ---------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** default = ink (primary). The ribbon colour is never a button fill. */
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive";
  size?: "sm" | "default" | "lg";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md border border-transparent font-medium whitespace-nowrap transition-colors select-none",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
        size === "sm" && "h-8 gap-1.5 px-3 text-[13px]",
        size === "default" && "h-9 px-4 text-sm",
        size === "lg" && "h-10 px-6 text-sm",
        variant === "default" &&
          "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary)_88%,var(--background))]",
        variant === "secondary" && "bg-secondary text-secondary-foreground hover:bg-accent",
        variant === "outline" && "border-input bg-background text-foreground shadow-xs hover:bg-accent",
        variant === "ghost" && "text-foreground hover:bg-accent",
        variant === "destructive" &&
          "bg-destructive text-destructive-foreground hover:bg-[color-mix(in_oklch,var(--destructive)_88%,var(--background))]",
        className,
      )}
      {...props}
    />
  ),
);

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  ({ className, label, ...props }, ref) => (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-foreground",
        className,
      )}
      {...props}
    />
  ),
);

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-muted px-[5px] font-mono text-[11px] leading-4 font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Muted disc with a 2px presence ring in the person's collaborator colour (chart-1…5). */
export function Avatar({ name, id, size = 28, ring }: { name: string; id: string; size?: number; ring?: boolean }) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border-2 bg-muted font-semibold text-foreground",
        ring && "shadow-[0_0_0_2px_var(--background)]",
      )}
      style={{ width: size, height: size, borderColor: colorFor(id), fontSize: Math.round(size * 0.36) }}
    >
      {initials(name) || "?"}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block size-4 animate-spin rounded-full border-2 border-input border-t-ribbon", className)}
    />
  );
}

/* ---------- Overlays ---------- */

function useDismiss(open: boolean, onClose: () => void, refs: React.RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      if (refs.every((r) => !r.current?.contains(e.target as Node))) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, onClose, refs]);
}

/** A floating panel anchored under (or above) an element. */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  align = "start",
  className,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const refs = useRef([panel, anchor]).current;
  useDismiss(open, onClose, refs);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const w = panel.current?.offsetWidth ?? 280;
    const h = panel.current?.offsetHeight ?? 300;
    let left = align === "end" ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    setPos({ top, left });
  }, [open, anchor, align]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      className={cn(
        "animate-pop fixed z-50 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

export function Dialog({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const refs = useRef([panel]).current;
  useDismiss(open, onClose, refs);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-[2px]">
      <div
        ref={panel}
        role="dialog"
        className={cn(
          "animate-pop w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg",
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  danger,
  hint,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  hint?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm transition-colors",
        danger ? "text-destructive hover:bg-accent" : "text-foreground hover:bg-accent",
      )}
    >
      {icon && <span className="flex size-4 items-center justify-center text-muted-foreground">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {hint}
    </button>
  );
}

/* ---------- Switch & Tabs (design system) ---------- */

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  /** Accessible name when there is no visible label. */
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-primary bg-primary" : "border-input bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] left-[2px] size-3.5 rounded-full transition-transform",
          checked ? "translate-x-4 bg-primary-foreground" : "bg-muted-foreground",
        )}
      />
    </button>
  );
}

export function Tabs<T extends string>({
  value,
  items,
  onChange,
}: {
  value: T;
  items: { value: T; label: ReactNode; icon?: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-[3px]">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-3 text-[13px] font-medium transition-colors [&_svg]:size-3.5",
            value === it.value
              ? "border-border bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}
