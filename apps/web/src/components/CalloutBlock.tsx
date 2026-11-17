import { createReactBlockSpec } from "@blocknote/react";
import { Info, Lightbulb, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { MenuItem, Popover } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export const CALLOUT_TONES = ["info", "tip", "warning", "danger"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/** Design system: tone is carried by icon + fill, never fill alone. */
export const CALLOUT_ICONS: Record<CalloutTone, LucideIcon> = {
  info: Info,
  tip: Lightbulb,
  warning: TriangleAlert,
  danger: OctagonAlert,
};

function CalloutIcon({
  tone,
  editable,
  onChange,
}: {
  tone: CalloutTone;
  editable: boolean;
  onChange: (tone: CalloutTone) => void;
}) {
  const { t } = useI18n();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const Icon = CALLOUT_ICONS[tone] ?? Info;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        contentEditable={false}
        disabled={!editable}
        aria-label={t("callout.changeTone")}
        title={editable ? t("callout.changeTone") : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="calepin-callout-icon"
      >
        <Icon size={18} aria-hidden />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} className="w-44">
        {CALLOUT_TONES.map((k) => {
          const I = CALLOUT_ICONS[k];
          return (
            <MenuItem
              key={k}
              icon={<I size={16} className={`calepin-callout-swatch-${k}`} />}
              hint={k === tone ? <span className="text-xs text-muted-foreground">✓</span> : undefined}
              onClick={() => {
                setOpen(false);
                onChange(k);
              }}
            >
              {t(`callout.${k}`)}
            </MenuItem>
          );
        })}
      </Popover>
    </>
  );
}

/**
 * A note set apart from the flow (design system "Callout"). The icon picks the tone.
 * Must match the server schema (apps/server/src/lib/blocks.ts).
 */
export const CalloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: { tone: { default: "info" as CalloutTone, values: CALLOUT_TONES } },
    content: "inline",
  },
  {
    render: ({ block, editor, contentRef }) => (
      <div className={`calepin-callout calepin-callout-${block.props.tone}`} role="note">
        <CalloutIcon
          tone={block.props.tone}
          editable={editor.isEditable}
          onChange={(tone) => editor.updateBlock(block, { props: { tone } })}
        />
        <div ref={contentRef} className="calepin-callout-body" />
      </div>
    ),
  },
);
