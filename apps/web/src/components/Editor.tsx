import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { en, fr } from "@blocknote/core/locales";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { BLOCKS_FRAGMENT, type Collab } from "@/lib/collab";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { resolvedColorFor } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const locales = { en, fr };

export type EditorHandle = { focusStart: () => void };

type Props = { pageId: string; collab: Collab; readOnly: boolean; onReady?: (handle: EditorHandle) => void };

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

export const Editor = forwardRef<EditorHandle, Props>(({ pageId, collab, readOnly, onReady }, ref) => {
  const { lang, t } = useI18n();
  const { theme } = useTheme();
  const { me } = useWorkspace();

  const editor = useCreateBlockNote(
    withCollaboration({
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
  };
  useImperativeHandle(ref, () => handle, [editor]);
  useEffect(() => {
    // Let ProseMirror attach to the DOM before handing out focus.
    const id = requestAnimationFrame(() => onReady?.(handle));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return <BlockNoteView editor={editor} theme={theme} editable={!readOnly} className="calepin-editor" />;
});
