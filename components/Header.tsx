"use client";
import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { Brain, ChevronDown, Database, Check, Layers } from "lucide-react";
import { formatBytes } from "@/utils/chunker";

const MODEL_TYPE_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  chat:  { label: "chat",  color: "text-blue-400",    bg: "bg-blue-400/10"    },
  code:  { label: "code",  color: "text-emerald-400", bg: "bg-emerald-400/10" },
  embed: { label: "embed", color: "text-amber-400",   bg: "bg-amber-400/10"   },
};

const CODE_KW  = ["coder","code","starcoder","deepseek","codellama","wizard","qwen"];
const EMBED_KW = ["embed","nomic","mxbai","all-minilm","bge"];

function classifyModel(name: string): "chat" | "code" | "embed" {
  const n = name.toLowerCase();
  if (EMBED_KW.some((k) => n.includes(k))) return "embed";
  if (CODE_KW.some((k) => n.includes(k))) return "code";
  return "chat";
}

export default function Header() {
  const {
    ollamaModel, setOllamaModel, ollamaModels, setOllamaModels,
    files, totalChunksIndexed,
  } = useAppStore();

  const [open, setOpen] = useState(false);

  useEffect(() => {
    const poll = async () => {
      try {
        const res  = await fetch("/api/models");
        const data = await res.json();
        if (data.status === "online") {
          const enriched = (data.models || []).map((m: { name: string; size: number; parameterSize?: string; family?: string }) => ({
            ...m,
            type: classifyModel(m.name),
          }));
          setOllamaModels(enriched);
        }
      } catch { /* silently ignore */ }
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [setOllamaModels]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-model-dropdown]")) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const embeddedCount = files.filter((f) => f.embedded).length;
  const chatModels    = ollamaModels.filter((m) => m.type !== "embed");
  const currentModel  = ollamaModels.find((m) => m.name === ollamaModel);

  return (
    <header className="flex items-center justify-between px-5 py-2.5 border-b border-border bg-surface flex-shrink-0 z-10">
      {/* Left — brand + stats */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent/20 border border-accent/30 flex items-center justify-center">
            <Brain size={13} className="text-accent" />
          </div>
          <span className="font-semibold text-[13px] tracking-tight">CodeMind</span>
        </div>

        {files.length > 0 && (
          <div className="hidden sm:flex items-center gap-2">
            <StatPill
              icon={<Layers size={10} />}
              value={`${embeddedCount}/${files.length}`}
              label="files"
              active={embeddedCount > 0}
            />
            {totalChunksIndexed > 0 && (
              <StatPill
                icon={<Database size={10} />}
                value={totalChunksIndexed.toLocaleString()}
                label="chunks"
                active={true}
              />
            )}
          </div>
        )}
      </div>

      {/* Right — status + model picker */}
      <div className="flex items-center gap-3">
        {/* Always-online status indicator */}
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-emerald-400" />
          <span className="text-[11px] hidden sm:inline text-emerald-400">Groq online</span>
        </div>

        {/* Model selector */}
        <div className="relative" data-model-dropdown>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] bg-bg border border-border px-2.5 py-1.5 rounded-lg hover:border-accent/40 transition-colors text-text-dim hover:text-text"
          >
            <span className="font-mono max-w-[160px] truncate">{ollamaModel}</span>
            {currentModel?.parameterSize && (
              <span className="text-[9px] text-muted bg-border/80 px-1 py-0.5 rounded">
                {currentModel.parameterSize}
              </span>
            )}
            <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-1.5 z-50 bg-surface border border-border rounded-xl shadow-2xl min-w-[260px] overflow-hidden">
              {chatModels.length > 0 ? (
                <>
                  <SectionHeader label="Available models" />
                  {chatModels.map((m) => {
                    const typeStyle = MODEL_TYPE_STYLES[m.type] || MODEL_TYPE_STYLES.chat;
                    return (
                      <button
                        key={m.name}
                        onClick={() => { setOllamaModel(m.name); setOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-border/60 transition-colors text-left"
                      >
                        {m.name === ollamaModel
                          ? <Check size={11} className="text-accent flex-shrink-0" />
                          : <span className="w-[11px] flex-shrink-0" />
                        }
                        <span className={`font-mono text-[11px] flex-1 truncate ${
                          m.name === ollamaModel ? "text-accent" : "text-text-dim"
                        }`}>
                          {m.name}
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${typeStyle.bg} ${typeStyle.color} flex-shrink-0`}>
                          {typeStyle.label}
                        </span>
                        {m.parameterSize && (
                          <span className="text-[9px] text-muted flex-shrink-0">{m.parameterSize}</span>
                        )}
                        {m.size > 0 && (
                          <span className="text-[9px] text-muted/70 flex-shrink-0">{formatBytes(m.size)}</span>
                        )}
                      </button>
                    );
                  })}
                </>
              ) : (
                <div className="px-4 py-4 text-center">
                  <p className="text-[11px] text-muted">Loading models…</p>
                </div>
              )}

              <div className="border-t border-border px-3 py-2 bg-bg/50">
                <p className="text-[10px] text-muted">
                  Embeddings use{" "}
                  <code className="text-accent">hash-based (fast mode)</code>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function StatPill({ icon, value, label, active }: {
  icon: React.ReactNode; value: string; label: string; active: boolean;
}) {
  return (
    <div className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border ${
      active ? "text-accent border-accent/20 bg-accent/5" : "text-muted border-border"
    }`}>
      {icon}
      <span className="font-mono font-medium">{value}</span>
      <span className="text-muted">{label}</span>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-3 py-1.5 text-[9px] font-semibold text-muted uppercase tracking-wider bg-bg/30">
      {label}
    </div>
  );
}