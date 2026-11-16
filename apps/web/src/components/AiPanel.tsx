import {
  ArrowDownToLine,
  BookOpenText,
  Copy,
  Languages,
  ListCollapse,
  PenLine,
  Replace,
  Scissors,
  Send,
  Sparkles,
  Square,
  WandSparkles,
  X,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { type AiAction, streamAi } from "@/lib/ai";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { EditorHandle } from "./Editor";
import { Button, IconButton, Tabs } from "./ui";

/** Just enough Markdown for answers: paragraphs, bullets, **bold**, `code` and links (in-app for /p/…). */
function Answer({ text }: { text: string }) {
  const inline = (line: string, key: number): ReactNode => {
    const parts = line.split(/(\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|`[^`]+`)/g);
    return (
      <Fragment key={key}>
        {parts.map((p, i) => {
          const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
          if (link) {
            const [, label, href] = link;
            return href!.startsWith("/p/") ? (
              <Link
                key={i}
                to={href!}
                className="underline decoration-input underline-offset-4 hover:decoration-foreground"
              >
                {label}
              </Link>
            ) : (
              <a key={i} href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                {label}
              </a>
            );
          }
          if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
          if (/^`[^`]+`$/.test(p))
            return (
              <code key={i} className="rounded bg-muted px-1 font-mono text-[12px]">
                {p.slice(1, -1)}
              </code>
            );
          return p;
        })}
      </Fragment>
    );
  };
  return (
    <div className="flex flex-col gap-2 text-sm leading-6">
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l)))
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.)\s/, ""), j)}</li>
              ))}
            </ul>
          );
        const heading = block.match(/^#{1,4}\s+(.*)$/);
        if (heading)
          return (
            <div key={i} className="font-semibold">
              {inline(heading[1]!, 0)}
            </div>
          );
        return (
          <p key={i} className="whitespace-pre-wrap">
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, j)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

type Mode = "page" | "notes";

/** Side sheet: writing help on the current page, or questions answered from all your notes. */
export function AiPanel({
  pageId,
  workspaceId,
  editor,
  canEdit,
  onClose,
}: {
  pageId: string;
  workspaceId: string;
  editor: EditorHandle | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<Mode>(editor ? "page" : "notes");
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastAction, setLastAction] = useState<AiAction | null>(null);
  const [selection, setSelection] = useState(() => editor?.getSelectedText() ?? "");
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      abort.current?.abort();
    };
  }, []);

  const run = async (action: AiAction, extra: { prompt?: string; language?: string } = {}) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const sel = editor?.getSelectedText() ?? selection;
    setSelection(sel);
    setOutput("");
    setError(null);
    setRunning(true);
    setLastAction(action);
    try {
      await streamAi(
        {
          action,
          lang,
          ...(action === "notes" ? { workspaceId } : { pageId, selection: sel || undefined }),
          ...extra,
        },
        setOutput,
        ctrl.signal,
      );
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abort.current === ctrl) setRunning(false);
    }
  };

  const submit = () => {
    const q = prompt.trim();
    if (!q) return;
    run(mode === "notes" ? "notes" : "ask", { prompt: q });
  };

  const actions: { action: AiAction; label: string; icon: ReactNode; language?: string }[] = [
    { action: "summarize", label: t("ai.summarize"), icon: <ListCollapse /> },
    { action: "improve", label: t("ai.improve"), icon: <WandSparkles /> },
    { action: "shorter", label: t("ai.shorter"), icon: <Scissors /> },
    { action: "continue", label: t("ai.continue"), icon: <PenLine /> },
    {
      action: "translate",
      label: lang === "fr" ? t("ai.toEnglish") : t("ai.toFrench"),
      icon: <Languages />,
      language: lang === "fr" ? "en" : "fr",
    },
  ];
  const canReplace =
    canEdit && !!editor && !!selection && !!lastAction && ["improve", "shorter", "translate"].includes(lastAction);

  return createPortal(
    <aside
      role="dialog"
      aria-label={t("ai.title")}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="size-4 text-ribbon" />
        <h2 className="heading flex-1">{t("ai.title")}</h2>
        <IconButton label={t("common.cancel")} onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>
      <div className="px-4 pt-3">
        <Tabs<Mode>
          value={mode}
          onChange={(m) => {
            setMode(m);
            setOutput("");
            setError(null);
          }}
          items={[
            ...(editor ? [{ value: "page" as const, label: t("ai.thisPage"), icon: <PenLine /> }] : []),
            { value: "notes", label: t("ai.myNotes"), icon: <BookOpenText /> },
          ]}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {mode === "page" && (
          <>
            {selection && (
              <div className="rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{t("ai.selection")}</span> «
                {selection.length > 140 ? `${selection.slice(0, 140)}…` : selection}»
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {actions.map((a) => (
                <button
                  key={a.action}
                  disabled={running}
                  onClick={() => run(a.action, a.language ? { language: a.language } : {})}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[13px] hover:bg-accent disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
                >
                  {a.icon}
                  {a.label}
                </button>
              ))}
            </div>
          </>
        )}
        {mode === "notes" && !output && !running && (
          <p className="text-sm text-muted-foreground">{t("ai.notesIntro")}</p>
        )}

        {(output || running || error) && (
          <div className="rounded-lg border border-border p-3">
            {output ? (
              <Answer text={output} />
            ) : running ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="size-4 animate-pulse text-ribbon" />
                {t("ai.thinking")}
              </div>
            ) : null}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {output && !running && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                {canEdit && editor && mode === "page" && (
                  <Button size="sm" variant="secondary" onClick={() => editor.insertMarkdown(output, "after")}>
                    <ArrowDownToLine />
                    {t("ai.insert")}
                  </Button>
                )}
                {canReplace && (
                  <Button size="sm" variant="secondary" onClick={() => editor!.insertMarkdown(output, "replace")}>
                    <Replace />
                    {t("ai.replace")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(output)}>
                  <Copy />
                  {t("common.copy")}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-2 border-t border-border p-3"
      >
        <textarea
          ref={input}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={mode === "notes" ? t("ai.askNotes") : t("ai.askPage")}
          className="min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground"
        />
        {running ? (
          <IconButton label={t("ai.stop")} onClick={() => abort.current?.abort()} className="size-9">
            <Square className="size-4" />
          </IconButton>
        ) : (
          <Button type="submit" className={cn("size-9 p-0")} aria-label={t("ai.send")} disabled={!prompt.trim()}>
            <Send />
          </Button>
        )}
      </form>
    </aside>,
    document.body,
  );
}
