import { createBundledHighlighter } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import { CALLOUT_KEYWORD, type CalloutTone } from "./callouts.js";
import { iconHtml } from "./icons.js";

/** Shiki grammars for CODE_LANGUAGES (same list as apps/web/src/lib/highlighter.ts). */
const languages = {
  shellscript: () => import("@shikijs/langs-precompiled/shellscript"),
  powershell: () => import("@shikijs/langs-precompiled/powershell"),
  bat: () => import("@shikijs/langs-precompiled/bat"),
  sql: () => import("@shikijs/langs-precompiled/sql"),
  python: () => import("@shikijs/langs-precompiled/python"),
  csharp: () => import("@shikijs/langs-precompiled/csharp"),
  javascript: () => import("@shikijs/langs-precompiled/javascript"),
  typescript: () => import("@shikijs/langs-precompiled/typescript"),
  jsx: () => import("@shikijs/langs-precompiled/jsx"),
  tsx: () => import("@shikijs/langs-precompiled/tsx"),
  json: () => import("@shikijs/langs-precompiled/json"),
  jsonc: () => import("@shikijs/langs-precompiled/jsonc"),
  yaml: () => import("@shikijs/langs-precompiled/yaml"),
  toml: () => import("@shikijs/langs-precompiled/toml"),
  ini: () => import("@shikijs/langs-precompiled/ini"),
  dotenv: () => import("@shikijs/langs-precompiled/dotenv"),
  xml: () => import("@shikijs/langs-precompiled/xml"),
  html: () => import("@shikijs/langs-precompiled/html"),
  css: () => import("@shikijs/langs-precompiled/css"),
  scss: () => import("@shikijs/langs-precompiled/scss"),
  markdown: () => import("@shikijs/langs-precompiled/markdown"),
  docker: () => import("@shikijs/langs-precompiled/docker"),
  nginx: () => import("@shikijs/langs-precompiled/nginx"),
  hcl: () => import("@shikijs/langs-precompiled/hcl"),
  terraform: () => import("@shikijs/langs-precompiled/terraform"),
  bicep: () => import("@shikijs/langs-precompiled/bicep"),
  kusto: () => import("@shikijs/langs-precompiled/kusto"),
  graphql: () => import("@shikijs/langs-precompiled/graphql"),
  go: () => import("@shikijs/langs-precompiled/go"),
  rust: () => import("@shikijs/langs-precompiled/rust"),
  java: () => import("@shikijs/langs-precompiled/java"),
  kotlin: () => import("@shikijs/langs-precompiled/kotlin"),
  swift: () => import("@shikijs/langs-precompiled/swift"),
  c: () => import("@shikijs/langs-precompiled/c"),
  cpp: () => import("@shikijs/langs-precompiled/cpp"),
  php: () => import("@shikijs/langs-precompiled/php"),
  ruby: () => import("@shikijs/langs-precompiled/ruby"),
  lua: () => import("@shikijs/langs-precompiled/lua"),
  r: () => import("@shikijs/langs-precompiled/r"),
  diff: () => import("@shikijs/langs-precompiled/diff"),
  make: () => import("@shikijs/langs-precompiled/make"),
  csv: () => import("@shikijs/langs-precompiled/csv"),
  log: () => import("@shikijs/langs-precompiled/log"),
  regexp: () => import("@shikijs/langs-precompiled/regexp"),
  vue: () => import("@shikijs/langs-precompiled/vue"),
  svelte: () => import("@shikijs/langs-precompiled/svelte"),
  mermaid: () => import("@shikijs/langs-precompiled/mermaid"),
  latex: () => import("@shikijs/langs-precompiled/latex"),
};

const createHighlighter = createBundledHighlighter({
  langs: languages,
  themes: {
    "github-light": () => import("@shikijs/themes/github-light"),
    "github-dark": () => import("@shikijs/themes/github-dark"),
  },
  engine: () => createJavaScriptRegexEngine(),
});
let highlighter: ReturnType<typeof createHighlighter> | null = null;

const unescape = (s: string) =>
  s
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

/**
 * Colours the code blocks of exported HTML (published pages). Tokens carry both themes' colours
 * as --shiki-light / --shiki-dark; the page's CSS picks one.
 */
export async function highlightCode(html: string): Promise<string> {
  const re = /<pre data-language="([^"]+)"><code[^>]*>([\s\S]*?)<\/code><\/pre>/g;
  const matches = [...html.matchAll(re)].filter((m) => m[1] !== "text" && m[1]! in languages);
  if (!matches.length) return html;
  highlighter ??= createHighlighter({ themes: ["github-light", "github-dark"], langs: [] });
  const hl = await highlighter;
  let out = "";
  let last = 0;
  for (const m of matches) {
    const lang = m[1]!;
    try {
      await hl.loadLanguage(lang as never);
      const code = hl.codeToHtml(unescape(m[2]!), {
        lang,
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: false,
      });
      out += html.slice(last, m.index) + code.replace("<pre ", `<pre data-language="${lang}" `);
      last = m.index! + m[0].length;
    } catch {
      // Leave the block as plain text.
    }
  }
  return out + html.slice(last);
}

const CALLOUT_ICON: Record<CalloutTone, string> = {
  info: "Info",
  tip: "Lightbulb",
  warning: "TriangleAlert",
  danger: "OctagonAlert",
};

/** Callouts are exported as alert quotes (for Markdown); published pages show them as callouts. */
export function renderCallouts(html: string): string {
  return html.replace(
    /<blockquote data-callout-tone="([a-z]+)"[^>]*><p>\[!\w+\]<\/p><p[^>]*>([\s\S]*?)<\/p><\/blockquote>/g,
    (all, tone: string, body: string) => {
      if (!(tone in CALLOUT_KEYWORD)) return all;
      const icon = iconHtml(`lucide:${CALLOUT_ICON[tone as CalloutTone]}`, 18);
      return `<div class="callout callout-${tone}" role="note"><span class="callout-icon">${icon}</span><div class="callout-body">${body}</div></div>`;
    },
  );
}
