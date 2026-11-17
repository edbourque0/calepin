/**
 * Languages offered in code blocks: id → display name and aliases (what follows ``` in Markdown).
 * Must match apps/server/src/lib/codeLanguages.ts, so Markdown round-trips keep the language.
 */
export const CODE_LANGUAGES: Record<string, { name: string; aliases?: string[] }> = {
  text: { name: "Plain text", aliases: ["text", "txt", "plain", "plaintext"] },
  shellscript: { name: "Shell", aliases: ["bash", "sh", "shell", "zsh", "console"] },
  powershell: { name: "PowerShell", aliases: ["ps", "ps1", "pwsh"] },
  bat: { name: "Batch", aliases: ["batch", "cmd"] },
  sql: { name: "SQL", aliases: [] },
  python: { name: "Python", aliases: ["py"] },
  csharp: { name: "C#", aliases: ["c#", "cs"] },
  javascript: { name: "JavaScript", aliases: ["js", "mjs", "cjs"] },
  typescript: { name: "TypeScript", aliases: ["ts", "mts", "cts"] },
  jsx: { name: "JSX", aliases: [] },
  tsx: { name: "TSX", aliases: [] },
  json: { name: "JSON", aliases: [] },
  jsonc: { name: "JSON with comments", aliases: [] },
  yaml: { name: "YAML", aliases: ["yml"] },
  toml: { name: "TOML", aliases: [] },
  ini: { name: "INI", aliases: ["properties", "conf"] },
  dotenv: { name: ".env", aliases: ["env"] },
  xml: { name: "XML", aliases: [] },
  html: { name: "HTML", aliases: ["htm"] },
  css: { name: "CSS", aliases: [] },
  scss: { name: "SCSS", aliases: [] },
  markdown: { name: "Markdown", aliases: ["md"] },
  docker: { name: "Dockerfile", aliases: ["dockerfile"] },
  nginx: { name: "Nginx", aliases: [] },
  hcl: { name: "HCL", aliases: [] },
  terraform: { name: "Terraform", aliases: ["tf", "tfvars"] },
  bicep: { name: "Bicep", aliases: [] },
  kusto: { name: "Kusto (KQL)", aliases: ["kql"] },
  graphql: { name: "GraphQL", aliases: ["gql"] },
  go: { name: "Go", aliases: ["golang"] },
  rust: { name: "Rust", aliases: ["rs"] },
  java: { name: "Java", aliases: [] },
  kotlin: { name: "Kotlin", aliases: ["kt", "kts"] },
  swift: { name: "Swift", aliases: [] },
  c: { name: "C", aliases: ["h"] },
  cpp: { name: "C++", aliases: ["c++", "hpp", "cc"] },
  php: { name: "PHP", aliases: [] },
  ruby: { name: "Ruby", aliases: ["rb"] },
  lua: { name: "Lua", aliases: [] },
  r: { name: "R", aliases: [] },
  diff: { name: "Diff", aliases: ["patch"] },
  make: { name: "Makefile", aliases: ["makefile"] },
  csv: { name: "CSV", aliases: [] },
  log: { name: "Log", aliases: [] },
  regexp: { name: "Regex", aliases: ["regex"] },
  vue: { name: "Vue", aliases: [] },
  svelte: { name: "Svelte", aliases: [] },
  mermaid: { name: "Mermaid", aliases: ["mmd"] },
  latex: { name: "LaTeX", aliases: ["tex"] },
};

export const DEFAULT_CODE_LANGUAGE = "text";

/** Language id for a name or alias ("ps1" → "powershell"); unknown names are kept as given. */
export function codeLanguageId(name: string): string {
  const n = name.trim().toLowerCase();
  if (!n) return DEFAULT_CODE_LANGUAGE;
  if (CODE_LANGUAGES[n]) return n;
  for (const [id, l] of Object.entries(CODE_LANGUAGES)) if (l.aliases?.includes(n)) return id;
  return n;
}

/** Normalises the language of code blocks (at any depth) parsed from Markdown. */
export function normaliseCodeLanguages<T>(blocks: T[]): T[] {
  return blocks.map((b) => {
    const block = b as { type: string; props?: Record<string, unknown>; children?: unknown[] };
    const next =
      block.type === "codeBlock" && typeof block.props?.language === "string"
        ? { ...block, props: { ...block.props, language: codeLanguageId(block.props.language) } }
        : block;
    return (
      Array.isArray(next.children) && next.children.length
        ? { ...next, children: normaliseCodeLanguages(next.children) }
        : next
    ) as T;
  });
}
