import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, type Me } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { Button, MenuItem, Popover } from "./ui";

export function WorkspaceSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const { me, workspace, setWorkspace } = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const choose = (id: string) => {
    setWorkspace(id);
    setOpen(false);
    navigate("/");
    onNavigate?.();
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const ws = await api.post<Me["workspaces"][number]>("/workspaces", { name: name.trim() });
    await qc.invalidateQueries({ queryKey: ["me"] });
    setName("");
    setCreating(false);
    choose(ws.id);
  };

  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        aria-label={t("ws.switch")}
        className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
      >
        <span className="min-w-0 flex-1 leading-tight">
          <span className="wordmark block text-[17px]">Calepin</span>
          <span className="block truncate text-xs text-muted-foreground">{workspace.name}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} className="w-64">
        <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">{me.user.email}</div>
        {me.workspaces.map((w) => (
          <MenuItem
            key={w.id}
            onClick={() => choose(w.id)}
            hint={w.id === workspace.id ? <Check className="size-4 text-foreground" /> : undefined}
          >
            {w.name}
          </MenuItem>
        ))}
        <div className="my-1 h-px bg-border" />
        {creating ? (
          <form onSubmit={create} className="flex gap-1.5 p-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("ws.namePlaceholder")}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs"
            />
            <Button size="sm" type="submit" disabled={!name.trim()}>
              {t("ws.createSubmit")}
            </Button>
          </form>
        ) : (
          <MenuItem icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t("ws.create")}
          </MenuItem>
        )}
      </Popover>
    </>
  );
}
