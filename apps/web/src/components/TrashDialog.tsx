import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, RotateCcw, Trash2 } from "lucide-react";
import { api, type TrashItem } from "@/lib/api";
import { useI18n, useRelativeTime } from "@/lib/i18n";
import { pagesKey, useWorkspace } from "@/lib/workspace";
import { Dialog, IconButton, Spinner } from "./ui";

export function TrashDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const rel = useRelativeTime();
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  const key = ["trash", workspace.id];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<TrashItem[]>(`/workspaces/${workspace.id}/trash`),
    enabled: open,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: pagesKey(workspace.id) });
  };
  const restore = useMutation({ mutationFn: (id: string) => api.post(`/pages/${id}/restore`), onSuccess: refresh });
  const destroy = useMutation({ mutationFn: (id: string) => api.delete(`/pages/${id}/permanent`), onSuccess: refresh });

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="heading">{t("trash.title")}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{data?.length ?? 0}</span>
      </div>
      <div className="max-h-[55vh] overflow-y-auto p-2">
        {isLoading && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}
        {data?.length === 0 && (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">{t("trash.empty")}</p>
        )}
        {data?.map((item) => (
          <div key={item.id} className="group flex h-10 items-center gap-2 rounded-sm px-2 hover:bg-accent">
            <span className="flex size-5 items-center justify-center text-muted-foreground">
              {item.icon ? (
                <span className="text-base leading-none">{item.icon}</span>
              ) : (
                <FileText className="size-4" />
              )}
            </span>
            <span className="flex-1 truncate text-sm">{item.title || t("page.untitled")}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{rel(item.deletedAt)}</span>
            <IconButton label={t("trash.restore")} onClick={() => restore.mutate(item.id)}>
              <RotateCcw className="size-4" />
            </IconButton>
            <IconButton
              label={t("trash.deleteForever")}
              className="hover:text-destructive"
              onClick={() => confirm(t("trash.confirm")) && destroy.mutate(item.id)}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
