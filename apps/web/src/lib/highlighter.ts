import { createBundledHighlighter } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import { SyntaxHighlightingExtension } from "@blocknote/core/extensions";

/**
 * Shiki grammars for the languages in CODE_LANGUAGES, loaded on first use (each is its own chunk).
 * Keyed by language id: code blocks store the id, never an alias.
 */
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

const themes = {
  "github-light": () => import("@shikijs/themes/github-light"),
  "github-dark": () => import("@shikijs/themes/github-dark"),
};

const createHighlighter = createBundledHighlighter({
  langs: languages,
  themes,
  // Precompiled grammars run on the JS regex engine: no WebAssembly to download.
  engine: () => createJavaScriptRegexEngine(),
});

/**
 * Colours code blocks. Tokens carry both themes' colours (--shiki-light / --shiki-dark);
 * styles.css picks the one for the current theme.
 */
export const syntaxHighlighter = SyntaxHighlightingExtension({
  createHighlighter: () => createHighlighter({ themes: ["github-light", "github-dark"], langs: [] }),
});
