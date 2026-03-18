"use client";
import { useState } from "react";
import FileExplorer from "./FileExplorer";
import CodeViewer from "./CodeViewer";
import ChatPanel from "./ChatPanel";
import Header from "./Header";
import { PanelLeftClose, PanelLeftOpen, MessageSquareCode, Code2 } from "lucide-react";

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen,    setChatOpen]    = useState(true);

  return (
    <div className="flex flex-col h-screen bg-bg text-text overflow-hidden">
      <Header />

      {/* ── Three-panel body ── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Left — file explorer */}
        <aside
          className="flex-shrink-0 border-r border-border transition-all duration-200 overflow-hidden"
          style={{ width: sidebarOpen ? "240px" : "0px" }}
        >
          <div className="w-[240px] h-full">
            <FileExplorer />
          </div>
        </aside>

        {/* Center — code viewer */}
        <main className="flex-1 overflow-hidden min-w-0">
          <CodeViewer />
        </main>

        {/* Right — chat panel */}
        <aside
          className="flex-shrink-0 border-l border-border transition-all duration-200 overflow-hidden"
          style={{ width: chatOpen ? "380px" : "0px" }}
        >
          <div className="w-[380px] h-full">
            <ChatPanel />
          </div>
        </aside>
      </div>

      {/* ── Status bar ── */}
      <div className="flex items-center gap-0 border-t border-border bg-surface flex-shrink-0 text-[10px] text-muted">
        {/* Toggle buttons */}
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 hover:text-text hover:bg-border/40 transition-colors border-r border-border"
          title={sidebarOpen ? "Hide explorer" : "Show explorer"}
        >
          {sidebarOpen
            ? <PanelLeftClose size={11} />
            : <PanelLeftOpen  size={11} />
          }
          <span className="hidden sm:inline">Explorer</span>
        </button>

        <button
          onClick={() => setChatOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 hover:text-text hover:bg-border/40 transition-colors border-r border-border"
          title={chatOpen ? "Hide chat" : "Show chat"}
        >
          <MessageSquareCode size={11} />
          <span className="hidden sm:inline">Chat</span>
        </button>

        {/* Centre — branding */}
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-l border-border">
          <Code2 size={10} />
          <span>CodeMind v2 · local AI · no data leaves your machine</span>
        </div>
      </div>
    </div>
  );
}
