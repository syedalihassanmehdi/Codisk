export interface TextChunk {
  content: string;
  startLine: number;
  endLine: number;
  type: "function" | "class" | "module" | "block" | "text";
  name?: string;        // function/class name if detectable
}

// ─── Structure-aware chunking ────────────────────────────────────────────────

const FUNCTION_PATTERNS = [
  /^(export\s+)?(async\s+)?function\s+(\w+)/,
  /^(export\s+)?const\s+(\w+)\s*=\s*(async\s*)?\(/,
  /^(export\s+)?const\s+(\w+)\s*=\s*(async\s*)?\w+\s*=>/,
  /^\s*(async\s+)?(\w+)\s*\([^)]*\)\s*\{/,
  /^def\s+(\w+)\s*\(/,                       // Python
  /^(pub\s+)?(async\s+)?fn\s+(\w+)/,         // Rust
  /^func\s+(\w+)/,                           // Go
];

const CLASS_PATTERNS = [
  /^(export\s+)?(abstract\s+)?class\s+(\w+)/,
  /^class\s+(\w+)/,
];

export function chunkCode(content: string, language = "text"): TextChunk[] {
  const MAX_CHUNK_LINES = 80;
  const LARGE_FILE_THRESHOLD = 1_000_000; // 1MB

  // Aggressively chunk very large files
  if (content.length > LARGE_FILE_THRESHOLD) {
    return chunkByLines(content, 50, 5);
  }

  const lines = content.split("\n");

  // For code files, try structure-aware chunking
  if (["javascript","typescript","jsx","tsx","python","go","rust","java","cpp","c","ruby","php"].includes(language)) {
    const structured = chunkByStructure(lines, MAX_CHUNK_LINES);
    if (structured.length > 0) return structured;
  }

  // Fallback: line-based chunking
  return chunkByLines(content, MAX_CHUNK_LINES, 10);
}

function chunkByStructure(lines: string[], maxLines: number): TextChunk[] {
  const chunks: TextChunk[] = [];
  const boundaries: number[] = [0]; // line indices where new blocks start

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimStart();
    const isFunction = FUNCTION_PATTERNS.some((p) => p.test(line));
    const isClass = CLASS_PATTERNS.some((p) => p.test(line));
    if ((isFunction || isClass) && i > 0) {
      boundaries.push(i);
    }
  }
  boundaries.push(lines.length);

  for (let b = 0; b < boundaries.length - 1; b++) {
    const start = boundaries[b];
    const end = boundaries[b + 1];

    // If this block is too large, split it further
    if (end - start > maxLines) {
      const sub = chunkByLines(lines.slice(start, end).join("\n"), maxLines, 8);
      sub.forEach((s) => {
        chunks.push({ ...s, startLine: s.startLine + start, endLine: s.endLine + start });
      });
      continue;
    }

    const blockLines = lines.slice(start, end);
    const content = blockLines.join("\n").trim();
    if (!content) continue;

    const firstLine = blockLines.find((l) => l.trim())?.trim() || "";
    const type = CLASS_PATTERNS.some((p) => p.test(firstLine))
      ? "class"
      : FUNCTION_PATTERNS.some((p) => p.test(firstLine))
      ? "function"
      : "block";

    // Try to extract name
    const nameMatch =
      firstLine.match(/(?:function|class|def|fn|func)\s+(\w+)/) ||
      firstLine.match(/const\s+(\w+)\s*=/);

    chunks.push({
      content,
      startLine: start + 1,
      endLine: end,
      type,
      name: nameMatch?.[1],
    });
  }

  return chunks.filter((c) => c.content.trim().length > 10);
}

function chunkByLines(content: string, chunkSize: number, overlap: number): TextChunk[] {
  const lines = content.split("\n");
  const chunks: TextChunk[] = [];

  if (lines.length <= chunkSize) {
    return [{ content: content.trim(), startLine: 1, endLine: lines.length, type: "text" }];
  }

  let i = 0;
  while (i < lines.length) {
    const end = Math.min(i + chunkSize, lines.length);
    const chunkContent = lines.slice(i, end).join("\n").trim();
    if (chunkContent) {
      chunks.push({ content: chunkContent, startLine: i + 1, endLine: end, type: "text" });
    }
    i += chunkSize - overlap;
  }

  return chunks;
}

// ─── File importance scoring ─────────────────────────────────────────────────

export function scoreFileImportance(filePath: string, _content: string): "high" | "medium" | "low" {
  const name = filePath.split("/").pop()?.toLowerCase() || "";
  const path = filePath.toLowerCase();

  // High importance
  const highPatterns = [
    /package\.json$/, /tsconfig/, /next\.config/, /vite\.config/, /webpack\.config/,
    /routes?\.(ts|js|tsx|jsx)$/, /router\.(ts|js|tsx|jsx)$/,
    /api\/.*route\.(ts|js)$/, /middleware\.(ts|js|tsx|jsx)$/,
    /index\.(ts|js|tsx|jsx)$/, /main\.(ts|js|tsx|jsx)$/,
    /app\.(ts|js|tsx|jsx)$/, /server\.(ts|js)$/,
    /schema\.(ts|js)$/, /types\.(ts|d\.ts)$/, /interface\.(ts)$/,
    /readme\.md$/i, /\.env\.example$/,
  ];

  if (highPatterns.some((p) => p.test(path))) return "high";

  // Low importance
  const lowPatterns = [
    /\.css$/, /\.scss$/, /\.less$/, /\.svg$/, /\.png$/, /\.jpg$/,
    /\.test\.(ts|js|tsx|jsx)$/, /\.spec\.(ts|js|tsx|jsx)$/, /\.stories\./,
    /node_modules/, /\.lock$/, /dist\//, /build\//,
  ];

  if (lowPatterns.some((p) => p.test(path))) return "low";

  return "medium";
}

export function importanceWeight(importance: "high" | "medium" | "low"): number {
  return importance === "high" ? 1.5 : importance === "medium" ? 1.0 : 0.6;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    js: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx",
    py: "python", html: "html", css: "css", scss: "css",
    json: "json", md: "markdown", txt: "text",
    go: "go", rs: "rust", java: "java", cpp: "cpp",
    c: "c", rb: "ruby", php: "php", sh: "bash",
    yaml: "yaml", yml: "yaml", toml: "toml", vue: "vue",
  };
  return map[ext] || "text";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Simple hash (FNV-1a) — fast enough for dedup, no crypto needed
export function hashContent(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

// Truncate context to approximate token limit (1 token ≈ 4 chars)
export function truncateToTokens(text: string, maxTokens = 6000): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...[truncated]";
}
