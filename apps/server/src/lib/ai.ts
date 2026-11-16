import { getSetting, setSetting } from "./settings.js";
import { openSecret, sealSecret } from "./secrets.js";

/**
 * AI assistant through any OpenAI-compatible chat completions API:
 * Ollama (local), OpenAI, Anthropic (its OpenAI-compatible endpoint), OpenRouter, LM Studio…
 */
export type AiProvider = "ollama" | "openai" | "anthropic" | "custom";
export type AiSettings = {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKeySealed: string;
};

export const AI_PRESETS: Record<AiProvider, { baseUrl: string; model: string }> = {
  ollama: { baseUrl: "http://ollama:11434/v1", model: "llama3.2" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5" },
  custom: { baseUrl: "", model: "" },
};

const DEFAULTS: AiSettings = { enabled: false, provider: "ollama", ...AI_PRESETS.ollama, apiKeySealed: "" };

let cache: { value: AiSettings; at: number } | null = null;

export async function getAiSettings(): Promise<AiSettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const value = { ...DEFAULTS, ...(await getSetting<Partial<AiSettings>>("ai", {})) };
  cache = { value, at: Date.now() };
  return value;
}

export async function saveAiSettings(input: Partial<Omit<AiSettings, "apiKeySealed">> & { apiKey?: string }) {
  const current = await getAiSettings();
  const { apiKey, ...rest } = input;
  const next: AiSettings = {
    ...current,
    ...rest,
    baseUrl: (rest.baseUrl ?? current.baseUrl).replace(/\/+$/, ""),
    apiKeySealed: apiKey === undefined || apiKey === "" ? current.apiKeySealed : sealSecret(apiKey),
  };
  if (apiKey === null) next.apiKeySealed = "";
  await setSetting("ai", next);
  cache = null;
  return next;
}

export const aiReady = (s: AiSettings) => s.enabled && !!s.baseUrl && !!s.model;

export class AiError extends Error {}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Streams the assistant's reply as text chunks. */
export async function* chat(
  settings: Pick<AiSettings, "baseUrl" | "model" | "apiKeySealed">,
  messages: ChatMessage[],
  opts: { apiKey?: string; maxTokens?: number; signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  const key = opts.apiKey || openSecret(settings.apiKeySealed);
  let res: Response;
  try {
    res = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        stream: true,
        max_tokens: opts.maxTokens ?? 2000,
      }),
      signal: opts.signal,
    });
  } catch (e) {
    throw new AiError(
      `Can't reach ${settings.baseUrl}: ${e instanceof Error ? ((e.cause as Error)?.message ?? e.message) : e}`,
    );
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = j.error?.message ?? j.error ?? j.message ?? detail;
    } catch {}
    throw new AiError(`${res.status} ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const chunk = JSON.parse(data);
        const text = chunk.choices?.[0]?.delta?.content;
        if (typeof text === "string" && text) yield text;
      } catch {
        /* keep-alive or partial line */
      }
    }
  }
}

/* ---------- Prompts ---------- */

export type AiAction = "summarize" | "continue" | "improve" | "shorter" | "translate" | "ask" | "notes";

const LANGS: Record<string, string> = { fr: "French", en: "English" };

export function buildMessages(input: {
  action: AiAction;
  page?: { title: string; markdown: string };
  selection?: string;
  prompt?: string;
  language?: string;
  lang: string;
  sources?: { id: string; title: string; text: string }[];
}): ChatMessage[] {
  const reply = LANGS[input.lang] ?? "the user's language";
  const system =
    "You are the writing assistant of Calepin, a note-taking app. Answer in Markdown only (no preamble, " +
    "no closing remarks, no code fences around the whole answer). Keep the author's tone and formatting.";
  const page = input.page ? `Page "${input.page.title || "Untitled"}":\n\n${input.page.markdown.slice(0, 24_000)}` : "";
  const target = input.selection?.trim() ? input.selection : (input.page?.markdown ?? "");
  switch (input.action) {
    case "summarize":
      return [
        { role: "system", content: system },
        { role: "user", content: `Summarize this in a few bullet points, in ${reply}.\n\n${target.slice(0, 24_000)}` },
      ];
    case "continue":
      return [
        { role: "system", content: system },
        {
          role: "user",
          content: `${page}\n\nContinue writing from where the page ends (one or two paragraphs). Return only the new text.`,
        },
      ];
    case "improve":
      return [
        { role: "system", content: system },
        {
          role: "user",
          content: `Improve the writing of this text: fix grammar and spelling, make it clearer, keep its language and meaning. Return only the rewritten text.\n\n${target}`,
        },
      ];
    case "shorter":
      return [
        { role: "system", content: system },
        {
          role: "user",
          content: `Make this shorter, keeping the key points and its language. Return only the text.\n\n${target}`,
        },
      ];
    case "translate":
      return [
        { role: "system", content: system },
        {
          role: "user",
          content: `Translate this into ${LANGS[input.language ?? ""] ?? input.language ?? "English"}. Return only the translation.\n\n${target}`,
        },
      ];
    case "notes": {
      const sources = (input.sources ?? [])
        .map((s, i) => `[${i + 1}] "${s.title || "Untitled"}" (link: /p/${s.id})\n${s.text}`)
        .join("\n\n---\n\n");
      return [
        {
          role: "system",
          content:
            `${system} Answer the question using only the user's notes below. Cite the notes you use as Markdown ` +
            `links to their page, like [Title](/p/<id>). If the notes don't contain the answer, say so. Reply in ${reply}.`,
        },
        { role: "user", content: `Notes:\n\n${sources || "(no matching notes)"}\n\nQuestion: ${input.prompt}` },
      ];
    }
    case "ask":
    default:
      return [
        { role: "system", content: system },
        {
          role: "user",
          content: `${page}${input.selection?.trim() ? `\n\nSelected text:\n${input.selection}` : ""}\n\nRequest: ${input.prompt}`,
        },
      ];
  }
}
