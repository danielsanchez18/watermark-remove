export type IssueType =
  | "zero-width"
  | "bidi"
  | "unusual-space"
  | "soft-hyphen"
  | "ai-signature"
  | "co-author-inline";

export type Severity = "high" | "medium" | "low";

export interface ScanIssue {
  type: IssueType;
  severity: Severity;
  line: number;
  column: number;
  length: number;
  description: string;
  snippet: string;
}

export interface CheckItem {
  id: string;
  label: string;
  group: "invisible" | "signature";
  found: number;
}

export interface ScanResult {
  path: string;
  issues: ScanIssue[];
  issueCount: number;
  byType: Record<string, number>;
  checks: CheckItem[];
  totalChecks: number;
  skipped?: boolean;
}

// Invisible / dangerous codepoints for code files
const INVISIBLE_CHARS: Array<{
  test: (cp: number) => boolean;
  type: IssueType;
  severity: Severity;
  name: string;
}> = [
  {
    test: (cp) =>
      cp === 0x200b ||
      cp === 0x200c ||
      cp === 0x200d ||
      cp === 0x2060 ||
      cp === 0xfeff ||
      cp === 0x180e ||
      (cp >= 0x200e && cp <= 0x200f),
    type: "zero-width",
    severity: "high",
    name: "zero-width/non-printing",
  },
  {
    test: (cp) =>
      (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069),
    type: "bidi",
    severity: "high",
    name: "bidi control",
  },
  {
    test: (cp) =>
      cp === 0x00a0 ||
      cp === 0x202f ||
      cp === 0x205f ||
      cp === 0x3000 ||
      (cp >= 0x2000 && cp <= 0x200a),
    type: "unusual-space",
    severity: "medium",
    name: "unusual space",
  },
  {
    test: (cp) => cp === 0x00ad,
    type: "soft-hyphen",
    severity: "low",
    name: "soft hyphen",
  },
];

// Known AI signature patterns (visible text)
const SIGNATURE_PATTERNS: Array<{
  regex: RegExp;
  type: IssueType;
  severity: Severity;
  description: string;
}> = [
  {
    regex: /generated\s+with\s+claude\s+code/i,
    type: "ai-signature",
    severity: "high",
    description: "Claude Code signature",
  },
  {
    regex: /generated\s+by\s+(claude|chatgpt|gpt|copilot|gemini|openai|anthropic)/i,
    type: "ai-signature",
    severity: "high",
    description: "AI generator signature",
  },
  {
    regex: /created\s+with\s+(claude|chatgpt|openai|copilot|gemini)/i,
    type: "ai-signature",
    severity: "high",
    description: "AI creation signature",
  },
  {
    regex: /co-authored-by:\s*(claude|chatgpt|openai|copilot|gemini|anthropic|noreply)/i,
    type: "co-author-inline",
    severity: "high",
    description: "AI co-author line in file",
  },
  {
    regex: /ai-generated|machine-generated|auto-generated\s+by\s+(ai|llm)/i,
    type: "ai-signature",
    severity: "medium",
    description: "AI generation marker",
  },
  {
    regex: /this\s+(file|code)\s+was\s+(generated|written|created)\s+by\s+an?\s+(ai|assistant|language\s+model)/i,
    type: "ai-signature",
    severity: "medium",
    description: "AI attribution sentence",
  },
  {
    regex: /prompt:\s*.{10,}/i,
    type: "ai-signature",
    severity: "low",
    description: "Possible embedded prompt",
  },
];

// File types we scan (text-based code)
const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".h", ".cpp", ".hpp", ".cs", ".php",
  ".html", ".htm", ".css", ".scss", ".less", ".svg",
  ".json", ".yml", ".yaml", ".toml", ".ini", ".env",
  ".md", ".mdx", ".txt", ".csv",
  ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd",
  ".sql", ".graphql", ".prisma",
  ".vue", ".svelte", ".astro",
  ".dockerfile", ".gitignore", ".editorconfig",
]);

const TEXT_FILENAMES = new Set([
  "dockerfile", "makefile", "readme", "license", "changelog",
  ".gitignore", ".gitattributes", ".env", ".env.local",
  "package.json", "tsconfig.json",
]);

export function isTextFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const base = lower.split(/[\\/]/).pop() ?? "";
  if (TEXT_FILENAMES.has(base)) return true;
  if (base.startsWith(".") && !base.includes(".", 1)) return true;
  const ext = base.includes(".") ? "." + base.split(".").pop() : "";
  return TEXT_EXTENSIONS.has(ext);
}

export function buildChecklist(byType: Record<string, number>): CheckItem[] {
  const checks: CheckItem[] = [
    { id: "zero-width", label: "Caracteres zero-width (U+200B…U+FEFF)", group: "invisible", found: 0 },
    { id: "bidi", label: "Controles bidireccionales (U+202A…U+2069)", group: "invisible", found: 0 },
    { id: "unusual-space", label: "Espacios no estándar (U+00A0, U+2000…)", group: "invisible", found: 0 },
    { id: "soft-hyphen", label: "Soft hyphens (U+00AD)", group: "invisible", found: 0 },
    { id: "ai-signature", label: "Firmas de generadores IA", group: "signature", found: 0 },
    { id: "co-author-inline", label: "Líneas Co-Authored-By en archivo", group: "signature", found: 0 },
  ];
  for (const c of checks) {
    c.found = byType[c.id] ?? 0;
  }
  return checks;
}

export function scanContent(filePath: string, content: string): ScanResult {
  const issues: ScanIssue[] = [];

  if (!isTextFile(filePath)) {
    return {
      path: filePath,
      issues: [],
      issueCount: 0,
      byType: {},
      checks: buildChecklist({}),
      totalChecks: SIGNATURE_PATTERNS.length + INVISIBLE_CHARS.length,
      skipped: true,
    };
  }

  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check each character for invisible codes
    for (let j = 0; j < line.length; j++) {
      const cp = line.codePointAt(j);
      if (cp === undefined) continue;
      // Handle surrogate pairs
      if (cp > 0xffff) j++;

      for (const rule of INVISIBLE_CHARS) {
        if (rule.test(cp)) {
          issues.push({
            type: rule.type,
            severity: rule.severity,
            line: lineNum,
            column: j + 1,
            length: cp > 0xffff ? 2 : 1,
            description: `${rule.name} (U+${cp.toString(16).toUpperCase().padStart(4, "0")})`,
            snippet: escapeSnippet(line),
          });
          break;
        }
      }
    }

    // Check for signature patterns
    for (const sig of SIGNATURE_PATTERNS) {
      sig.regex.lastIndex = 0;
      const match = sig.regex.exec(line);
      if (match) {
        issues.push({
          type: sig.type,
          severity: sig.severity,
          line: lineNum,
          column: (match.index ?? 0) + 1,
          length: match[0].length,
          description: sig.description,
          snippet: escapeSnippet(line),
        });
      }
    }
  }

  const byType: Record<string, number> = {};
  for (const issue of issues) {
    byType[issue.type] = (byType[issue.type] ?? 0) + 1;
  }

  return {
    path: filePath,
    issues,
    issueCount: issues.length,
    byType,
    checks: buildChecklist(byType),
    totalChecks: SIGNATURE_PATTERNS.length + INVISIBLE_CHARS.length,
  };
}

function escapeSnippet(s: string): string {
  // Show invisible chars as visible markers in snippets
  return s
    .replace(/\u200b|\u200c|\u200d|\u2060|\ufeff|\u180e/g, "⟨ZW⟩")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "⟨BIDI⟩")
    .replace(/\u00a0/g, "⟨NBSP⟩")
    .replace(/\u2000-\u200a/g, "⟨ISP⟩")
    .replace(/\u202f/g, "⟨NNBSP⟩")
    .replace(/\u205f/g, "⟨MMSP⟩")
    .replace(/\u3000/g, "⟨IDSP⟩")
    .replace(/\u00ad/g, "⟨SHY⟩")
    .slice(0, 200);
}
