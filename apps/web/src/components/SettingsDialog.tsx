import { useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { type Lang, useI18n } from "@/lib/i18n";
import { type ThemePref, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { Dialog } from "./ui";

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md border border-transparent px-3 text-[13px] font-medium transition-colors",
            value === o.value ? "border-border bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang, setLang } = useI18n();
  const { pref, setPref } = useTheme();
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  const [name, setName] = useState(workspace.name);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === workspace.name) return;
    await api.patch(`/workspaces/${workspace.id}`, { name: trimmed });
    qc.invalidateQueries({ queryKey: ["me"] });
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="border-b border-border px-5 py-4">
        <h2 className="heading">{t("settings.title")}</h2>
      </div>
      <div className="divide-y divide-border px-5">
        {workspace.role === "owner" && (
          <Row label={t("settings.workspace")}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm shadow-xs"
            />
          </Row>
        )}
        <Row label={t("settings.theme")}>
          <Segmented<ThemePref>
            value={pref}
            onChange={setPref}
            options={[
              { value: "system", label: (<><Monitor className="size-3.5" />{t("settings.system")}</>) },
              { value: "dark", label: (<><Moon className="size-3.5" />{t("settings.dark")}</>) },
              { value: "light", label: (<><Sun className="size-3.5" />{t("settings.light")}</>) },
            ]}
          />
        </Row>
        <Row label={t("settings.language")}>
          <Segmented<Lang>
            value={lang}
            onChange={setLang}
            options={[
              { value: "fr", label: "Français" },
              { value: "en", label: "English" },
            ]}
          />
        </Row>
      </div>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
