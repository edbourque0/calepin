import { useQuery } from "@tanstack/react-query";
import { api, type AppConfig } from "./api";

export type AiAction = "summarize" | "continue" | "improve" | "shorter" | "translate" | "ask" | "notes";

/** Whether an administrator set up the AI assistant. */
export function useAiEnabled() {
  const { data } = useQuery({ queryKey: ["config"], queryFn: () => api.get<AppConfig>("/config"), staleTime: 60_000 });
  return !!data?.ai;
}

/** Streams a completion; calls onText with the full text so far. */
export async function streamAi(
  body: {
    action: AiAction;
    pageId?: string;
    workspaceId?: string;
    selection?: string;
    prompt?: string;
    language?: string;
    lang: string;
  },
  onText: (text: string) => void,
  signal: AbortSignal,
) {
  const res = await fetch("/api/ai/complete", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? res.statusText);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += value;
    onText(text);
  }
  return text;
}

/** Opens the assistant from anywhere in the page (menu item, shortcut). */
export const openAiPanel = () => window.dispatchEvent(new CustomEvent("calepin:ai"));
