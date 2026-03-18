"use client";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useAppStore } from "@/lib/store";
import { buildFileTree, FileTreeNode, countFiles } from "@/utils/fileTree";
import { formatBytes, getLanguage, hashContent, scoreFileImportance, generateId } from "@/utils/chunker";
import {
  Upload, CheckCircle2, Loader2, X, ChevronRight, ChevronDown,
  FolderOpen, Folder, FileCode, AlertTriangle, Zap, RotateCcw,
} from "lucide-react";

// Language → colour mapping (VS Code–inspired)
const LANG_COLORS: Record<string, string> = {
  typescript: "#3178c6",
  javascript: "#f0db4f",
  python:     "#4b8bbe",
  jsx:        "#61dafb",
  tsx:        "#61dafb",
  html:       "#e34c26",
  css:        "#2965f1",
  scss:       "#c6538c",
  json:       "#f5a623",
  markdown:   "#6d7a86",
  go:         "#00add8",
  rust:       "#ce4a00",
  java:       "#b07219",
  vue:        "#41b883",
  bash:       "#89e051",
  yaml:       "#cb171e",
};

const IMPORTANCE_CONFIG = {
  high:   { dot: "bg-amber-400",   title: "High priority file (route/config/entry)" },
  medium: { dot: "bg-blue-400/50", title: "Medium priority" },
  low:    { dot: "bg-zinc-600",    title: "Low priority (styles/assets/tests)" },
};

// ─── Allowed file extensions ─────────────────────────────────────────────────
const ALLOWED_EXTS = new Set([
  "js","ts","jsx","tsx","py","html","css","scss","json","md","txt",
  "vue","go","rs","java","cpp","c","rb","php","yaml","yml","toml",
  "sh","env","prisma","graphql","sql","gitignore","lock",
]);

export default function FileExplorer() {
  const {
    files, addFiles, removeFile, selectFile, selectedFileId,
    isEmbedding, setIsEmbedding, setEmbeddingProgress, setEmbeddingStatus,
    embeddingProgress, embeddingStatus, markFileEmbedded, setTotalChunksIndexed,
  } = useAppStore();

  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // ── Process raw File objects → call /api/upload ──────────────────────────
  const processFiles = useCallback(
    async (rawFiles: File[], overridePaths: string[] = []) => {
      if (rawFiles.length === 0) return;
      setIsUploading(true);
      setUploadError(null);

      try {
        const formData = new FormData();
        rawFiles.forEach((f, i) => {
          formData.append("files", f);
          formData.append("paths", overridePaths[i] || f.name);
        });

        const res  = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();

        if (data.files?.length) addFiles(data.files);

        if (data.skipped?.length) {
          setUploadError(`Skipped ${data.skipped.length} file(s): ${data.skipped.slice(0, 3).join(", ")}${data.skipped.length > 3 ? "…" : ""}`);
        }

        // Auto-expand top-level directories
        if (data.files?.length) {
          const topDirs = new Set<string>();
          data.files.forEach((f: { path: string }) => {
            const parts = f.path.split("/");
            if (parts.length > 1) topDirs.add(parts[0]);
          });
          setExpanded((prev) => new Set([...Array.from(prev), ...Array.from(topDirs)]));
        }
      } catch (e) {
        setUploadError("Upload failed — check the console");
        console.error(e);
      } finally {
        setIsUploading(false);
      }
    },
    [addFiles]
  );

  // ── Drop handler ─────────────────────────────────────────────────────────
  const onDrop = useCallback(
    async (accepted: File[]) => {
      // Separate ZIPs from regular files
      const zips    = accepted.filter((f) => f.name.endsWith(".zip"));
      const regular = accepted.filter((f) => !f.name.endsWith(".zip"));

      if (regular.length) await processFiles(regular);

      for (const zip of zips) {
        try {
          // Dynamically import JSZip so it's never loaded on the server
          const JSZip     = (await import("jszip")).default;
          const loaded    = await JSZip.loadAsync(await zip.arrayBuffer());
          const zipFiles: File[]   = [];
          const zipPaths: string[] = [];

          for (const [path, entry] of Object.entries(loaded.files)) {
            if (entry.dir) continue;
            // Skip common noise
            if (/node_modules\/|\.git\/|\.DS_Store|__pycache__|\.pyc$/.test(path)) continue;

            const name = path.split("/").pop() || path;
            const ext  = name.split(".").pop()?.toLowerCase() || "";
            if (!ALLOWED_EXTS.has(ext)) continue;

            const blob = await entry.async("blob");
            zipFiles.push(new File([blob], name));
            zipPaths.push(path);
          }

          if (zipFiles.length) await processFiles(zipFiles, zipPaths);
        } catch (err) {
          setUploadError(`Could not extract "${zip.name}"`);
          console.error(err);
        }
      }
    },
    [processFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/*":                     [".js",".ts",".jsx",".tsx",".py",".html",".css",".json",".md"],
      "application/zip":            [".zip"],
      "application/x-zip-compressed": [".zip"],
    },
    noClick: false,
  });

  // ── Embed all un-indexed files ───────────────────────────────────────────
  const embedAll = async () => {
    const pending = files
      .filter((f) => !f.embedded)
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 } as const;
        return order[a.importance] - order[b.importance];
      });

    if (!pending.length) return;

    setIsEmbedding(true);
    let done = 0;

    for (const file of pending) {
      setEmbeddingStatus(file.name);
      try {
        const res  = await fetch("/api/embed", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ file, model: "nomic-embed-text" }),
        });
        const data = await res.json();
        if (data.success) {
          markFileEmbedded(file.id);
          setTotalChunksIndexed(data.totalChunks ?? 0);
        }
      } catch (e) {
        console.error("Embed error:", file.name, e);
      }

      done++;
      setEmbeddingProgress(Math.round((done / pending.length) * 100));
    }

    setIsEmbedding(false);
    setEmbeddingStatus("");
    setEmbeddingProgress(0);
  };

  // ── Delete a file ────────────────────────────────────────────────────────
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const file = files.find((f) => f.id === id);
    try {
      await fetch("/api/embed", {
        method:  "DELETE",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ fileId: id, blobUrl: file?.blobUrl }),
      });
    } catch { /* ignore */ }
    removeFile(id);
  };

  const toggleDir = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const tree            = buildFileTree(files);
  const unembeddedCount = files.filter((f) => !f.embedded).length;

  return (
    <div className="h-full flex flex-col bg-surface overflow-hidden select-none">

      {/* ── Top controls ── */}
      <div className="p-3 border-b border-border space-y-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted uppercase tracking-widest">Explorer</span>
          <span className="text-[10px] font-mono text-muted">{files.length} files</span>
        </div>

        {/* Drop zone */}
        <div
          {...getRootProps()}
          className={`border border-dashed rounded-lg p-3 text-center cursor-pointer transition-all duration-200 ${
            isDragActive
              ? "border-accent bg-accent/10 scale-[1.02]"
              : "border-border hover:border-accent/40 hover:bg-border/20"
          }`}
        >
          <input {...getInputProps()} />
          {isUploading ? (
            <Loader2 size={15} className="mx-auto mb-1 text-accent animate-spin" />
          ) : (
            <Upload size={15} className={`mx-auto mb-1 ${isDragActive ? "text-accent" : "text-muted"}`} />
          )}
          <p className="text-[11px] text-muted leading-tight">
            {isDragActive ? "Drop it!" : "Drop files or .zip"}
          </p>
        </div>

        {/* Error banner */}
        {uploadError && (
          <div className="flex items-start gap-1.5 text-[10px] text-amber-400 bg-amber-400/8 border border-amber-400/20 rounded-lg px-2.5 py-2">
            <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="leading-snug">{uploadError}</span>
            <button onClick={() => setUploadError(null)} className="ml-auto flex-shrink-0">
              <X size={10} />
            </button>
          </div>
        )}

        {/* Index button */}
        {unembeddedCount > 0 && (
          <button
            onClick={embedAll}
            disabled={isEmbedding}
            className="w-full flex items-center justify-center gap-1.5 bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded-lg px-3 py-2 text-[11px] font-semibold transition-all disabled:opacity-60"
          >
            {isEmbedding ? (
              <>
                <Loader2 size={11} className="animate-spin flex-shrink-0" />
                <span className="truncate">
                  {embeddingStatus ? `${embeddingStatus}` : `${embeddingProgress}%`}
                </span>
              </>
            ) : (
              <>
                <Zap size={11} />
                Index {unembeddedCount} file{unembeddedCount !== 1 ? "s" : ""}
              </>
            )}
          </button>
        )}

        {/* Progress bar */}
        {isEmbedding && (
          <div className="h-0.5 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-500 rounded-full"
              style={{ width: `${embeddingProgress}%` }}
            />
          </div>
        )}
      </div>

      {/* ── File tree ── */}
      <div className="flex-1 overflow-y-auto py-1 min-h-0">
        {tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full pb-10 gap-3 text-muted">
            <FolderOpen size={28} className="opacity-20" />
            <p className="text-[11px] text-center leading-snug">
              No files yet.<br />Drop some code above.
            </p>
          </div>
        ) : (
          <TreeNodes
            nodes={tree}
            depth={0}
            expanded={expanded}
            toggleDir={toggleDir}
            selectedFileId={selectedFileId}
            selectFile={selectFile}
            handleDelete={handleDelete}
          />
        )}
      </div>

      {/* ── Legend ── */}
      {files.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 border-t border-border flex-shrink-0">
          {(["high", "medium", "low"] as const).map((lvl) => (
            <span key={lvl} className="flex items-center gap-1 text-[9px] text-muted" title={IMPORTANCE_CONFIG[lvl].title}>
              <span className={`w-1.5 h-1.5 rounded-full ${IMPORTANCE_CONFIG[lvl].dot}`} />
              {lvl}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Recursive tree renderer ─────────────────────────────────────────────────

function TreeNodes({
  nodes, depth, expanded, toggleDir, selectedFileId, selectFile, handleDelete,
}: {
  nodes:           FileTreeNode[];
  depth:           number;
  expanded:        Set<string>;
  toggleDir:       (path: string) => void;
  selectedFileId:  string | null;
  selectFile:      (id: string | null) => void;
  handleDelete:    (id: string, e: React.MouseEvent) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.type === "dir" ? (
          <DirRow
            key={node.path}
            node={node}
            depth={depth}
            expanded={expanded}
            toggleDir={toggleDir}
            selectedFileId={selectedFileId}
            selectFile={selectFile}
            handleDelete={handleDelete}
          />
        ) : (
          <FileRow
            key={node.path}
            node={node}
            depth={depth}
            selected={selectedFileId === node.fileId}
            selectFile={selectFile}
            handleDelete={handleDelete}
          />
        )
      )}
    </>
  );
}

function DirRow({
  node, depth, expanded, toggleDir, selectedFileId, selectFile, handleDelete,
}: {
  node:           FileTreeNode;
  depth:          number;
  expanded:       Set<string>;
  toggleDir:      (path: string) => void;
  selectedFileId: string | null;
  selectFile:     (id: string | null) => void;
  handleDelete:   (id: string, e: React.MouseEvent) => void;
}) {
  const isOpen     = expanded.has(node.path);
  const childCount = countFiles(node);

  return (
    <>
      <button
        onClick={() => toggleDir(node.path)}
        className="w-full flex items-center gap-1 py-1 hover:bg-border/40 transition-colors text-left"
        style={{ paddingLeft: `${6 + depth * 12}px`, paddingRight: "8px" }}
      >
        <span className="text-muted flex-shrink-0">
          {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        {isOpen
          ? <FolderOpen size={12} className="text-accent/70 flex-shrink-0" />
          : <Folder     size={12} className="text-accent/40 flex-shrink-0" />
        }
        <span className="text-[11px] text-text-dim truncate flex-1 ml-1">{node.name}</span>
        <span className="text-[9px] text-muted ml-auto">{childCount}</span>
      </button>

      {isOpen && node.children && (
        <TreeNodes
          nodes={node.children}
          depth={depth + 1}
          expanded={expanded}
          toggleDir={toggleDir}
          selectedFileId={selectedFileId}
          selectFile={selectFile}
          handleDelete={handleDelete}
        />
      )}
    </>
  );
}

function FileRow({
  node, depth, selected, selectFile, handleDelete,
}: {
  node:         FileTreeNode;
  depth:        number;
  selected:     boolean;
  selectFile:   (id: string | null) => void;
  handleDelete: (id: string, e: React.MouseEvent) => void;
}) {
  const color = LANG_COLORS[node.language || ""] || "#8b90a8";
  const imp   = node.importance ? IMPORTANCE_CONFIG[node.importance] : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => selectFile(node.fileId ?? null)}
      onKeyDown={(e) => e.key === "Enter" && selectFile(node.fileId ?? null)}
      className={`group flex items-center gap-1.5 py-[3px] cursor-pointer transition-colors border-l-[2px] ${
        selected
          ? "bg-accent/10 border-accent text-text"
          : "border-transparent hover:bg-border/30 text-text-dim"
      }`}
      style={{ paddingLeft: `${16 + depth * 12}px`, paddingRight: "8px" }}
    >
      <FileCode size={11} style={{ color }} className="flex-shrink-0" />
      <span className="truncate flex-1 text-[11px]">{node.name}</span>

      {/* Trailing indicators */}
      <span className="flex items-center gap-1 flex-shrink-0">
        {imp && (
          <span
            className={`w-1.5 h-1.5 rounded-full ${imp.dot}`}
            title={imp.title}
          />
        )}
        {node.embedded
          ? <CheckCircle2 size={10} className="text-emerald-400" />
          : <span className="w-2.5 h-2.5 rounded-full border border-muted/40 opacity-60" title="Not indexed" />
        }
        <button
          onClick={(e) => handleDelete(node.fileId!, e)}
          className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all ml-0.5"
          title="Remove file"
        >
          <X size={10} />
        </button>
      </span>
    </div>
  );
}
