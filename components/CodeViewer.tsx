"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { formatBytes } from "@/utils/chunker";
import {
  FileCode, Copy, Check, ChevronUp, ChevronDown,
  AlertTriangle, WrapText, AlignLeft,
} from "lucide-react";

// Virtualisation threshold — above this many lines we render only visible rows
const VIRTUAL_THRESHOLD = 400;
const LINE_HEIGHT        = 20; // px per line (matches text-[12px] + leading)

export default function CodeViewer() {
  const { files, selectedFileId } = useAppStore();
  const file = files.find((f) => f.id === selectedFileId);

  const [highlighted, setHighlighted] = useState<string>("");
  const [loading,     setLoading]     = useState(false);
  const [copied,      setCopied]      = useState(false);
  const [wrap,        setWrap]        = useState(false);
  const [search,      setSearch]      = useState("");
  const [matchIdx,    setMatchIdx]    = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Syntax highlight ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!file) { setHighlighted(""); return; }
    setLoading(true);

    // For very large files skip shiki (too slow)
    if (file.content.length > 200_000) {
      setHighlighted("");
      setLoading(false);
      return;
    }

    let cancelled = false;
    const lang = file.language === "text" ? "plaintext" : file.language;

    import("shiki").then(({ codeToHtml }) =>
      codeToHtml(file.content, { lang, theme: "tokyo-night" })
    ).then((html) => {
      if (!cancelled) { setHighlighted(html); setLoading(false); }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [file]);

  // ── Copy ─────────────────────────────────────────────────────────────────
  const handleCopy = async () => {
    if (!file) return;
    await navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Search / jump ────────────────────────────────────────────────────────
  const lines = useMemo(() => file?.content.split("\n") ?? [], [file]);

  const matchLines = useMemo(() => {
    if (!search.trim() || !file) return [];
    const q = search.toLowerCase();
    return lines.reduce<number[]>((acc, line, i) => {
      if (line.toLowerCase().includes(q)) acc.push(i);
      return acc;
    }, []);
  }, [search, lines, file]);

  const jumpToMatch = (dir: 1 | -1) => {
    if (!matchLines.length) return;
    const next = (matchIdx + dir + matchLines.length) % matchLines.length;
    setMatchIdx(next);
    const lineEl = document.getElementById(`line-${matchLines[next]}`);
    lineEl?.scrollIntoView({ block: "center" });
  };

  // ── Virtual rendering for large files ───────────────────────────────────
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewHeight(el.clientHeight);
    const onScroll = () => setScrollTop(el.scrollTop);
    const onResize = () => setViewHeight(el.clientHeight);
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => { el.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onResize); };
  }, [file]);

  const isLarge  = lines.length > VIRTUAL_THRESHOLD;
  const useShiki = !!highlighted && !isLarge;

  // Virtual window
  const padLines    = 20;
  const startLine   = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - padLines);
  const visibleRows = Math.ceil(viewHeight / LINE_HEIGHT) + padLines * 2;
  const endLine     = Math.min(lines.length, startLine + visibleRows);

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!file) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-bg gap-4 text-muted">
        <div className="w-16 h-16 rounded-2xl bg-surface border border-border flex items-center justify-center">
          <FileCode size={26} className="opacity-30" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-text-dim">No file selected</p>
          <p className="text-xs mt-1">Pick a file from the explorer</p>
        </div>
      </div>
    );
  }

  const lineCount = lines.length;
  const isHuge    = file.content.length > 200_000;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg">

      {/* ── Tab bar ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface flex-shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FileCode size={13} className="text-accent flex-shrink-0" />
          <span className="text-[12px] font-mono text-text truncate">{file.path || file.name}</span>
          {!file.embedded && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded flex-shrink-0">
              <AlertTriangle size={9} />
              not indexed
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-[10px] text-muted flex-shrink-0">
          <span>{lineCount.toLocaleString()} lines</span>
          <span>{formatBytes(file.size)}</span>
          <span className="font-mono">{file.language}</span>

          {/* Search */}
          <div className="relative flex items-center">
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setMatchIdx(0); }}
              placeholder="Search…"
              className="bg-bg border border-border rounded px-2 py-0.5 text-[10px] w-28 focus:outline-none focus:border-accent/50 text-text placeholder-muted"
            />
            {search && (
              <span className="ml-1 text-[10px] text-muted whitespace-nowrap">
                {matchLines.length ? `${matchIdx + 1}/${matchLines.length}` : "0/0"}
              </span>
            )}
            {matchLines.length > 0 && (
              <>
                <button onClick={() => jumpToMatch(-1)} className="ml-0.5 hover:text-text"><ChevronUp  size={11} /></button>
                <button onClick={() => jumpToMatch(1)}  className="ml-0.5 hover:text-text"><ChevronDown size={11} /></button>
              </>
            )}
          </div>

          {/* Wrap toggle */}
          <button
            onClick={() => setWrap((v) => !v)}
            title="Toggle word wrap"
            className={`transition-colors ${wrap ? "text-accent" : "hover:text-text"}`}
          >
            <WrapText size={13} />
          </button>

          {/* Copy */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 hover:text-text transition-colors px-2 py-0.5 rounded hover:bg-border"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* ── Code body ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        style={{ fontSize: "12px", lineHeight: `${LINE_HEIGHT}px` }}
      >
        {loading ? (
          <div className="flex items-center justify-center h-32 text-muted text-xs gap-2">
            <span className="animate-spin">⟳</span> Highlighting…
          </div>
        ) : useShiki ? (
          // ── Shiki HTML output (small files) ──
          <div
            className={`p-4 [&_pre]:!bg-transparent [&_pre]:!p-0 [&_code]:!text-[12px] [&_code]:!leading-5 ${wrap ? "[&_pre]:whitespace-pre-wrap" : "[&_pre]:whitespace-pre"}`}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          // ── Plain text / virtual rendering (large files) ──
          <div
            className="relative font-mono"
            style={{ height: `${lines.length * LINE_HEIGHT}px` }}
          >
            {/* Visible slice */}
            <div style={{ position: "absolute", top: `${startLine * LINE_HEIGHT}px`, width: "100%" }}>
              {lines.slice(startLine, endLine).map((line, offset) => {
                const lineNum   = startLine + offset;
                const isMatch   = search && line.toLowerCase().includes(search.toLowerCase());
                const isCurrentMatch = isMatch && matchLines[matchIdx] === lineNum;
                return (
                  <div
                    key={lineNum}
                    id={`line-${lineNum}`}
                    className={`flex min-h-[20px] ${
                      isCurrentMatch ? "bg-accent/20" : isMatch ? "bg-accent/8" : ""
                    }`}
                    style={{ height: `${LINE_HEIGHT}px` }}
                  >
                    <span className="w-12 text-right pr-4 text-muted/50 flex-shrink-0 select-none">
                      {lineNum + 1}
                    </span>
                    <span
                      className={`flex-1 px-2 text-text-dim ${wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre overflow-hidden"}`}
                    >
                      {line || " "}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {isHuge && (
          <div className="sticky bottom-0 left-0 right-0 flex items-center justify-center py-1 bg-amber-500/10 border-t border-amber-500/20">
            <AlertTriangle size={11} className="text-amber-400 mr-1.5" />
            <span className="text-[10px] text-amber-400">
              Large file — syntax highlighting disabled. Showing plain text.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
