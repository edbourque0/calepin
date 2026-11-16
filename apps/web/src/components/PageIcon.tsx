import { FileText, Table2 } from "lucide-react";
import { iconColorVar, type IconNode, parseIcon, useIconSet } from "@/lib/icons";
import { cn } from "@/lib/utils";

/** Draws one Lucide icon from the lazily loaded set (an empty box of the same size while it loads). */
export function LucideGlyph({
  name,
  size = 16,
  color,
  strokeWidth = 2,
  className,
}: {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}) {
  const icons = useIconSet();
  const node: IconNode | undefined = icons?.[name];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("shrink-0", className)}
      style={color ? { color } : undefined}
    >
      {node?.map(([tag, attrs], i) => {
        const Tag = tag as "path";
        return <Tag key={i} {...(attrs as object)} />;
      })}
    </svg>
  );
}

/**
 * A page's icon: emoji or Lucide icon, or a fallback (page / database glyph) when it has none.
 * `size` is in pixels; emoji are drawn at the same visual size.
 */
export function PageIcon({
  icon,
  size = 16,
  type,
  fallback = true,
  className,
}: {
  icon: string | null | undefined;
  size?: number;
  type?: string;
  fallback?: boolean;
  className?: string;
}) {
  const parsed = parseIcon(icon);
  if (!parsed) {
    if (!fallback) return null;
    const Fallback = type === "database" ? Table2 : FileText;
    return <Fallback size={size} className={cn("shrink-0 text-muted-foreground", className)} />;
  }
  if (parsed.kind === "emoji")
    return (
      <span
        className={cn("inline-flex shrink-0 items-center justify-center leading-none", className)}
        style={{ fontSize: size * 0.95, width: size * 1.15, height: size * 1.15 }}
      >
        {parsed.value}
      </span>
    );
  return (
    <LucideGlyph
      name={parsed.name}
      size={size}
      strokeWidth={size >= 32 ? 1.5 : 2}
      color={iconColorVar(parsed.color)}
      className={cn(parsed.color === "default" && "text-foreground/80", className)}
    />
  );
}
