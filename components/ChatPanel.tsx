"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import type { ChatMessage } from "@/lib/store";
import {
  Send, Trash2, Bot, User, FileCode, Loader2,
  AlertCircle, Square, Sparkles, Bug, BookOpen,
  ChevronDown, ChevronUp, Copy, Check, Pencil,
  CheckCircle, XCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { generateId } from "@/utils/chunker";

const QUICK_PROMPTS = [
  "What does this codebase do?",
  "How is the project structured?",
  "Find potential bugs or issues",
  "Explain the main data flow",
  "What technologies are used?",
];

export default function ChatPanel() {
  const {
    messages, addMessage, appendToLastMessage, updateLastMessage,
    setLastMessageSources, setLastMessageEditProposal,
    isChatLoading, setIsChatLoading,
    clearChat, ollamaModel, files, stopGeneration, setAbortController,
    abortController, selectedFileId, updateFileContent,
  } = useAppStore();

  const [input,       setInput]       = useState("");
  const [error,       setError]       = useState<string | null>(null);
  const [editMode,    setEditMode]    = useState(false);
  const [editTarget,  setEditTarget]  = useState<string>(""); // fileId

  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // When edit mode toggles on, pre-select the currently viewed file
  useEffect(() => {
    if (editMode && selectedFileId) setEditTarget(selectedFileId);
  }, [editMode, selectedFileId]);

  // ── Core stream reader ────────────────────────────────────────────────────
  const readStream = useCallback(
    async (res: Response) => {
      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value, { stream: true }).split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.type === "token")   appendToLastMessage(json.token);
            if (json.type === "sources") setLastMessageSources(json.sources);
            if (json.type === "error")   throw new Error(json.error);
          } catch (pe) {
            if (pe instanceof SyntaxError) continue;
            throw pe;
          }
        }
      }
    },
    [appendToLastMessage, setLastMessageSources]
  );

  // ── Send a regular chat message ───────────────────────────────────────────
  const sendMessage = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || isChatLoading) return;
      setInput("");
      setError(null);

      addMessage({ id: generateId(), role: "user",      content: q, timestamp: Date.now() });
      addMessage({ id: generateId(), role: "assistant", content: "", timestamp: Date.now() });
      setIsChatLoading(true);

      const ctrl = new AbortController();
      setAbortController(ctrl);

      try {
        const res = await fetch("/api/chat", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          signal:  ctrl.signal,
          body: JSON.stringify({
            question: q,
            model:    ollamaModel,
            history:  messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
            topK:     8,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        await readStream(res);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (msg.includes("abort") || msg === "AbortError") {
          updateLastMessage("*Generation stopped.*");
        } else {
          const friendly = msg.includes("fetch") || msg.includes("connect")
            ? "Could not reach the API. Check your GROQ_API_KEY and restart the server."
            : msg.slice(0, 200);
          updateLastMessage(`❌ ${friendly}`);
          setError(friendly);
        }
      } finally {
        setIsChatLoading(false);
        setAbortController(null);
      }
    },
    [isChatLoading, messages, ollamaModel, addMessage, appendToLastMessage,
     updateLastMessage, setIsChatLoading, setAbortController, readStream]
  );

  // ── Send an edit request ──────────────────────────────────────────────────
  const sendEdit = useCallback(
    async (instruction: string) => {
      const q = instruction.trim();
      if (!q || isChatLoading) return;

      const targetFile = files.find((f) => f.id === editTarget);
      if (!targetFile) { setError("No file selected for editing."); return; }
      if (!targetFile.content) { setError("File has no content to edit (may be too large)."); return; }

      setInput("");
      setError(null);
      setEditMode(false);

      addMessage({
        id: generateId(), role: "user",
        content: `✏️ Edit \`${targetFile.path}\`: ${q}`,
        timestamp: Date.now(),
      });
      addMessage({
        id: generateId(), role: "assistant",
        content: "", timestamp: Date.now(),
      });
      setIsChatLoading(true);

      const ctrl = new AbortController();
      setAbortController(ctrl);

      let accumulated = "";

      try {
        const res = await fetch("/api/edit", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          signal:  ctrl.signal,
          body: JSON.stringify({
            filePath:    targetFile.path,
            fileContent: targetFile.content,
            instruction: q,
            model:       ollamaModel,
          }),
        });
        if (!res.ok) throw new Error(await res.text());

        // Stream tokens but accumulate separately — we'll show a diff preview
        const reader  = res.body!.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const lines = decoder.decode(value, { stream: true }).split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              if (json.type === "token") {
                accumulated += json.token;
                appendToLastMessage(json.token);
              }
              if (json.type === "error") throw new Error(json.error);
            } catch (pe) {
              if (pe instanceof SyntaxError) continue;
              throw pe;
            }
          }
        }

        // Attach edit proposal to the message for the Apply/Reject UI
        setLastMessageEditProposal({
          fileId:      targetFile.id,
          filePath:    targetFile.path,
          newContent:  accumulated,
          instruction: q,
        });

      } catch (err) {
        const msg = err instanceof Error ? err.message : "Edit failed";
        if (!msg.includes("abort")) {
          updateLastMessage(`❌ ${msg}`);
          setError(msg);
        } else {
          updateLastMessage("*Edit stopped.*");
        }
      } finally {
        setIsChatLoading(false);
        setAbortController(null);
      }
    },
    [isChatLoading, files, editTarget, ollamaModel, addMessage, appendToLastMessage,
     updateLastMessage, setIsChatLoading, setAbortController, setLastMessageEditProposal]
  );

  // ── Run analysis ──────────────────────────────────────────────────────────
  const runAnalysis = useCallback(
    async (type: "explain" | "bugs" | "docs") => {
      if (isChatLoading) return;
      setError(null);
      const labels = {
        explain: "🔍 Explain the entire project",
        bugs:    "🐛 Find bugs in the codebase",
        docs:    "📖 Generate project documentation",
      };
      addMessage({ id: generateId(), role: "user",      content: labels[type], timestamp: Date.now() });
      addMessage({ id: generateId(), role: "assistant", content: "", timestamp: Date.now(), isAnalysis: true });
      setIsChatLoading(true);

      const ctrl = new AbortController();
      setAbortController(ctrl);
      try {
        const res = await fetch("/api/analyze", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          signal:  ctrl.signal,
          body:    JSON.stringify({ type, model: ollamaModel }),
        });
        if (!res.ok) throw new Error(await res.text());
        await readStream(res);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Analysis failed";
        if (!msg.includes("abort")) { updateLastMessage(`❌ ${msg}`); setError(msg); }
        else updateLastMessage("*Analysis stopped.*");
      } finally {
        setIsChatLoading(false);
        setAbortController(null);
      }
    },
    [isChatLoading, ollamaModel, addMessage, setIsChatLoading,
     setAbortController, updateLastMessage, readStream]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      editMode ? sendEdit(input) : sendMessage(input);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  };

  const embeddedCount = files.filter((f) => f.embedded).length;
  const selectedFile  = files.find((f) => f.id === (editTarget || selectedFileId));

  return (
    <div className="flex flex-col h-full bg-surface overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bot size={13} className="text-accent" />
          <span className="text-[12px] font-semibold">Chat</span>
          {embeddedCount > 0 && (
            <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full flex items-center gap-1">
              <FileCode size={9} />
              {embeddedCount} indexed
            </span>
          )}
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="flex items-center gap-1 text-[10px] text-muted hover:text-red-400 transition-colors"
          >
            <Trash2 size={10} /> Clear
          </button>
        )}
      </div>

      {/* ── Analysis + Edit buttons ── */}
      {embeddedCount > 0 && (
        <div className="flex gap-1.5 px-3 py-2 border-b border-border flex-shrink-0">
          <AnalysisButton icon={<Sparkles size={10} />} label="Explain"   onClick={() => runAnalysis("explain")} disabled={isChatLoading} title="Summarise the entire codebase" />
          <AnalysisButton icon={<Bug      size={10} />} label="Find Bugs" onClick={() => runAnalysis("bugs")}    disabled={isChatLoading} title="Audit all indexed code for bugs" />
          <AnalysisButton icon={<BookOpen size={10} />} label="Gen Docs"  onClick={() => runAnalysis("docs")}    disabled={isChatLoading} title="Auto-generate a README.md" />
          <AnalysisButton
            icon={<Pencil size={10} />}
            label="Edit File"
            onClick={() => setEditMode((v) => !v)}
            disabled={isChatLoading}
            title="Ask AI to edit a file"
            active={editMode}
          />
        </div>
      )}

      {/* ── Edit target picker ── */}
      {editMode && (
        <div className="px-3 py-2 border-b border-border bg-amber-400/5 flex-shrink-0">
          <p className="text-[10px] text-amber-400 mb-1.5 font-medium">Select file to edit:</p>
          <select
            value={editTarget}
            onChange={(e) => setEditTarget(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-2 py-1.5 text-[11px] font-mono text-text focus:outline-none focus:border-accent/50"
          >
            <option value="">— choose a file —</option>
            {files.map((f) => (
              <option key={f.id} value={f.id}>{f.path || f.name}</option>
            ))}
          </select>
          {selectedFile && (
            <p className="text-[10px] text-muted mt-1">
              Then describe your change below and press ↵
            </p>
          )}
        </div>
      )}

      {/* ── Message list ── */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.length === 0 && <EmptyState onQuickPrompt={sendMessage} />}
        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isStreaming={isChatLoading && i === messages.length - 1 && msg.role === "assistant"}
            onApplyEdit={(fileId, newContent) => {
              updateFileContent(fileId, newContent);
            }}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Input area ── */}
      <div className="px-3 pb-3 pt-2 border-t border-border flex-shrink-0">
        {error && (
          <div className="flex items-start gap-2 text-[11px] text-red-400 bg-red-400/8 border border-red-400/20 rounded-lg px-3 py-2 mb-2">
            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><XIcon size={10} /></button>
          </div>
        )}

        {editMode && (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400 mb-1.5">
            <Pencil size={9} />
            <span>Edit mode — describe the change to make in <span className="font-mono">{selectedFile?.path || "selected file"}</span></span>
          </div>
        )}

        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={
              editMode
                ? "Describe the edit… e.g. 'Add error handling to the fetch call'"
                : embeddedCount > 0
                  ? "Ask about your codebase… (↵ send)"
                  : "Index files first, then chat…"
            }
            rows={1}
            style={{ resize: "none" }}
            className={`flex-1 bg-bg border rounded-xl px-3.5 py-2.5 text-[12px] placeholder-muted focus:outline-none transition-colors font-sans leading-relaxed min-h-[40px] ${
              editMode
                ? "border-amber-400/40 focus:border-amber-400/70"
                : "border-border focus:border-accent/50"
            }`}
          />
          {isChatLoading ? (
            <button
              onClick={stopGeneration}
              title="Stop generation"
              className="w-9 h-9 bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              onClick={() => editMode ? sendEdit(input) : sendMessage(input)}
              disabled={!input.trim() || (editMode && !editTarget)}
              className={`w-9 h-9 text-white rounded-xl flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 ${
                editMode ? "bg-amber-500 hover:bg-amber-600" : "bg-accent hover:bg-accent-dim"
              }`}
            >
              {editMode ? <Pencil size={13} /> : <Send size={13} />}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between mt-1.5 px-0.5">
          <span className="text-[10px] text-muted">Shift+↵ for newline</span>
          <span className="text-[10px] font-mono text-accent/70">{ollamaModel}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function XIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function AnalysisButton({
  icon, label, onClick, disabled, title, active = false,
}: {
  icon: React.ReactNode; label: string; onClick: () => void;
  disabled: boolean; title: string; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-medium border rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? "bg-amber-400/10 border-amber-400/40 text-amber-400"
          : "bg-bg border-border hover:border-accent/30 hover:text-accent text-text-dim"
      }`}
    >
      {icon}{label}
    </button>
  );
}

function EmptyState({ onQuickPrompt }: { onQuickPrompt: (q: string) => void }) {
  return (
    <div className="py-6 px-2 text-center">
      <div className="w-10 h-10 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-3">
        <Bot size={18} className="text-accent" />
      </div>
      <p className="text-[12px] text-text-dim font-medium mb-1">Ask anything about your code</p>
      <p className="text-[10px] text-muted mb-4">Upload + index files, then chat with your codebase</p>
      <div className="space-y-1.5">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onQuickPrompt(prompt)}
            className="block w-full text-left text-[11px] text-muted bg-bg border border-border hover:border-accent/30 hover:text-text px-3 py-2 rounded-lg transition-all"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  msg, isStreaming, onApplyEdit,
}: {
  msg: ChatMessage;
  isStreaming: boolean;
  onApplyEdit: (fileId: string, newContent: string) => void;
}) {
  const [showSources, setShowSources] = useState(false);
  const [copied,      setCopied]      = useState(false);
  const [applied,     setApplied]     = useState(false);
  const [rejected,    setRejected]    = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = () => {
    if (!msg.editProposal) return;
    onApplyEdit(msg.editProposal.fileId, msg.editProposal.newContent);
    setApplied(true);
  };

  if (msg.role === "user") {
    return (
      <div className="flex gap-2 justify-end animate-fadeUp">
        <div className="max-w-[85%] bg-accent/12 border border-accent/20 rounded-2xl rounded-tr-sm px-3.5 py-2.5">
          <p className="text-[12px] leading-relaxed text-text">{msg.content}</p>
        </div>
        <div className="w-6 h-6 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center flex-shrink-0 mt-0.5">
          <User size={10} className="text-accent" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 animate-fadeUp">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 border ${
        msg.isAnalysis ? "bg-accent/20 border-accent/40" : "bg-surface border-border"
      }`}>
        <Bot size={10} className="text-accent" />
      </div>

      <div className="flex-1 min-w-0 group">
        {!msg.content && isStreaming && (
          <div className="flex items-center gap-2 py-2 text-text-dim">
            <Loader2 size={12} className="animate-spin flex-shrink-0" />
            <span className="text-[11px]">
              {msg.editProposal !== undefined ? "Generating edit…" : msg.isAnalysis ? "Analysing codebase…" : "Thinking…"}
            </span>
          </div>
        )}

        {msg.content && (
          <div className="prose prose-invert max-w-none text-[12px]
            [&_p]:text-text [&_p]:leading-relaxed [&_p]:my-1.5
            [&_pre]:bg-bg [&_pre]:border [&_pre]:border-border [&_pre]:rounded-lg
            [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:my-2
            [&_code]:text-accent [&_code]:text-[11px] [&_code]:font-mono
            [&_pre_code]:text-text-dim
            [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:text-text [&_h1]:mt-3 [&_h1]:mb-1
            [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-text [&_h2]:mt-2.5 [&_h2]:mb-1
            [&_h3]:text-[12px] [&_h3]:font-semibold [&_h3]:text-text-dim [&_h3]:mt-2 [&_h3]:mb-0.5
            [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_li]:text-text
            [&_strong]:text-text [&_strong]:font-semibold
            [&_em]:text-text-dim
            [&_blockquote]:border-l-2 [&_blockquote]:border-accent/40 [&_blockquote]:pl-3 [&_blockquote]:text-text-dim
            [&_table]:w-full [&_table]:text-[11px]
            [&_th]:text-left [&_th]:p-1.5 [&_th]:border-b [&_th]:border-border [&_th]:text-text-dim
            [&_td]:p-1.5 [&_td]:border-b [&_td]:border-border/50 [&_td]:text-text
            [&_hr]:border-border [&_hr]:my-3
          ">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-0.5 h-3.5 bg-accent ml-0.5 align-middle cursor-blink" />
            )}
          </div>
        )}

        {/* ── Apply / Reject edit proposal ── */}
        {!isStreaming && msg.editProposal && !rejected && (
          <div className={`mt-2 border rounded-lg overflow-hidden ${
            applied ? "border-emerald-400/30 bg-emerald-400/5" : "border-amber-400/30 bg-amber-400/5"
          }`}>
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Pencil size={10} className="text-amber-400" />
                <span className="text-[11px] text-amber-400 font-medium font-mono truncate max-w-[160px]">
                  {msg.editProposal.filePath}
                </span>
              </div>
              {applied ? (
                <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                  <CheckCircle size={11} /> Applied
                </span>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setRejected(true)}
                    className="flex items-center gap-1 text-[10px] text-muted hover:text-red-400 transition-colors px-2 py-1 rounded border border-border hover:border-red-400/30"
                  >
                    <XCircle size={10} /> Reject
                  </button>
                  <button
                    onClick={handleApply}
                    className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors px-2 py-1 rounded border border-emerald-400/30 hover:border-emerald-400/60 bg-emerald-400/10"
                  >
                    <CheckCircle size={10} /> Apply changes
                  </button>
                </div>
              )}
            </div>
            {applied && (
              <p className="px-3 pb-2 text-[10px] text-emerald-400/70">
                File updated in editor. Re-index to update AI context.
              </p>
            )}
            {rejected && (
              <p className="px-3 pb-2 text-[10px] text-muted">Changes discarded.</p>
            )}
          </div>
        )}

        {/* Footer: sources + copy */}
        {!isStreaming && msg.content && (
          <div className="flex items-center gap-2 mt-1.5">
            {msg.sources && msg.sources.length > 0 && (
              <button
                onClick={() => setShowSources((v) => !v)}
                className="flex items-center gap-1 text-[10px] text-muted hover:text-text-dim transition-colors"
              >
                <FileCode size={9} />
                {msg.sources.length} source{msg.sources.length > 1 ? "s" : ""}
                {showSources ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
              </button>
            )}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[10px] text-muted hover:text-text-dim opacity-0 group-hover:opacity-100 transition-all"
              title="Copy response"
            >
              {copied ? <Check size={9} className="text-emerald-400" /> : <Copy size={9} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}

        {showSources && msg.sources && (
          <div className="mt-1.5 space-y-0.5">
            {msg.sources.map((s) => (
              <div
                key={s}
                className="text-[10px] font-mono text-accent/70 bg-accent/5 border border-accent/10 px-2 py-0.5 rounded truncate"
                title={s}
              >
                {s}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}