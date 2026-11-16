import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { BlockNoteSchema, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { en, fr } from "@blocknote/core/locales";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { Table2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { DatabaseBlock } from "@/components/database/DatabaseBlock";
import { BLOCKS_FRAGMENT, type Collab } from "@/lib/collab";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { resolvedColorFor } from "@/lib/utils";
import { usePageActions, useWorkspace } from "@/lib/workspace";

const locales = { en, fr };

/** BlockNote's blocks plus Calepin's inline database. Must match apps/server/src/lib/blocks.ts. */
export const schema = BlockNoteSchema.create().extend({ blockSpecs: { database: DatabaseBlock() } });

export type EditorHandle = {
  focusStart: () => void;
  /** Text currently selected in the editor ("" when nothing is). */
  getSelectedText: () => string;
  /** Inserts Markdown after the cursor's block, or in place of the selected blocks. */
  insertMarkdown: (markdown: string, mode: "after" | "replace") => Promise<void>;
};

type Props = {
  pageId: string;
  workspaceId: string;
  collab: Collab;
  readOnly: boolean;
  onReady?: (handle: EditorHandle) => void;
};

/** Uploads to Calepin, which stores the file (disk or S3) and serves it back through an authenticated link. */
async function uploadFile(pageId: string, file: File) {
  const res = await fetch(`/api/pages/${pageId}/files`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
    body: file,
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    const message = data.error ?? res.statusText;
    window.alert(message);
    throw new Error(message);
  }
  return data.url;
}

export const Editor = forwardRef<EditorHandle, Props>(({ pageId, workspaceId, collab, readOnly, onReady }, ref) => {
  const { lang, t } = useI18n();
  const { theme } = useTheme();
  const { me } = useWorkspace();
  const { create } = usePageActions();

  const editor = useCreateBlockNote(
    withCollaboration({
      schema,
      uploadFile: (file: File) => uploadFile(pageId, file),
      dictionary: {
        ...locales[lang],
        placeholders: { ...locales[lang].placeholders, default: t("page.editorPlaceholder") },
      },
      collaboration: {
        fragment: collab.doc.getXmlFragment(BLOCKS_FRAGMENT),
        provider: { awareness: collab.provider.awareness ?? undefined },
        user: { name: me.user.name, color: resolvedColorFor(me.user.id) },
        showCursorLabels: "activity",
      },
    }),
    [collab, lang, pageId],
  );

  const handle: EditorHandle = {
    focusStart: () => {
      const first = editor.document[0];
      if (first) editor.setTextCursorPosition(first, "start");
      editor.focus();
    },
    getSelectedText: () => editor.getSelectedText(),
    insertMarkdown: async (markdown, mode) => {
      const blocks = await editor.tryParseMarkdownToBlocks(markdown);
      if (!blocks.length) return;
      const selected = editor.getSelection()?.blocks;
      if (mode === "replace" && selected?.length) {
        editor.replaceBlocks(selected, blocks);
        return;
      }
      const anchor = selected?.at(-1) ?? editor.getTextCursorPosition().block;
      editor.insertBlocks(blocks, anchor, "after");
    },
  };
  useImperativeHandle(ref, () => handle, [editor]);
  useEffect(() => {
    // Let ProseMirror attach to the DOM before handing out focus.
    const id = requestAnimationFrame(() => onReady?.(handle));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const databaseItem = {
    title: t("slash.database"),
    subtext: t("slash.databaseHint"),
    aliases: ["database", "table", "db", "base", "tableau", "bd"],
    group: "Calepin",
    icon: <Table2 size={18} />,
    onItemClick: async () => {
      const db = await create.mutateAsync({
        parentId: pageId,
        workspaceId,
        database: { tags: t("db.defaultTags"), view: t("db.defaultView") },
      });
      insertOrUpdateBlockForSlashMenu(editor, { type: "database", props: { databaseId: db.id } });
    },
  };

  return (
    <BlockNoteView editor={editor} theme={theme} editable={!readOnly} slashMenu={false} className="calepin-editor">
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) =>
          filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), databaseItem], query)
        }
      />
    </BlockNoteView>
  );
});
