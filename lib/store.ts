import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface UploadedFile {
  id: string;
  name: string;
  path: string;
  content: string;
  language: string;
  size: number;
  embedded: boolean;
  hash: string;
  importance: "high" | "medium" | "low";
  blobUrl?: string;   // ← Vercel Blob URL for persistent storage
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  sources?: string[];
  isAnalysis?: boolean;
  editProposal?: {
    fileId: string;
    filePath: string;
    newContent: string;
    instruction: string;
  };
}

export interface OllamaModelInfo {
  name: string;
  size: number;
  parameterSize?: string;
  family?: string;
  type: "chat" | "code" | "embed";
}

interface AppState {
  files: UploadedFile[];
  selectedFileId: string | null;
  messages: ChatMessage[];
  isEmbedding: boolean;
  isChatLoading: boolean;
  embeddingProgress: number;
  embeddingStatus: string;
  ollamaModel: string;
  ollamaModels: OllamaModelInfo[];
  abortController: AbortController | null;
  totalChunksIndexed: number;

  addFiles: (files: UploadedFile[]) => void;
  removeFile: (id: string) => void;
  selectFile: (id: string | null) => void;
  markFileEmbedded: (id: string) => void;
  updateFileContent: (id: string, content: string) => void;
  updateFileImportance: (id: string, importance: UploadedFile["importance"]) => void;
  addMessage: (msg: ChatMessage) => void;
  updateLastMessage: (content: string) => void;
  appendToLastMessage: (chunk: string) => void;
  setLastMessageSources: (sources: string[]) => void;
  setLastMessageEditProposal: (proposal: ChatMessage["editProposal"]) => void;
  clearChat: () => void;
  setIsEmbedding: (v: boolean) => void;
  setIsChatLoading: (v: boolean) => void;
  setEmbeddingProgress: (v: number) => void;
  setEmbeddingStatus: (s: string) => void;
  setOllamaModel: (m: string) => void;
  setOllamaModels: (models: OllamaModelInfo[]) => void;
  setAbortController: (ctrl: AbortController | null) => void;
  setTotalChunksIndexed: (n: number) => void;
  stopGeneration: () => void;
  clearAll: () => void;
}

const DEFAULT_MODEL = "llama-3.3-70b-versatile";

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      files: [],
      selectedFileId: null,
      messages: [],
      isEmbedding: false,
      isChatLoading: false,
      embeddingProgress: 0,
      embeddingStatus: "",
      ollamaModel: DEFAULT_MODEL,
      ollamaModels: [],
      abortController: null,
      totalChunksIndexed: 0,

      addFiles: (newFiles) =>
        set((s) => {
          const existingHashes = new Set(s.files.map((f) => f.hash));
          const unique = newFiles.filter((f) => !existingHashes.has(f.hash));
          return { files: [...s.files, ...unique] };
        }),

      removeFile: (id) =>
        set((s) => ({
          files:          s.files.filter((f) => f.id !== id),
          selectedFileId: s.selectedFileId === id ? null : s.selectedFileId,
        })),

      selectFile: (id) => set({ selectedFileId: id }),

      markFileEmbedded: (id) =>
        set((s) => ({
          files: s.files.map((f) => (f.id === id ? { ...f, embedded: true } : f)),
        })),

      updateFileContent: (id, content) =>
        set((s) => ({
          files: s.files.map((f) =>
            f.id === id ? { ...f, content, size: content.length } : f
          ),
        })),

      updateFileImportance: (id, importance) =>
        set((s) => ({
          files: s.files.map((f) => (f.id === id ? { ...f, importance } : f)),
        })),

      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

      updateLastMessage: (content) =>
        set((s) => {
          const msgs = [...s.messages];
          if (msgs.length > 0) msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content };
          return { messages: msgs };
        }),

      appendToLastMessage: (chunk) =>
        set((s) => {
          const msgs = [...s.messages];
          if (msgs.length > 0) {
            msgs[msgs.length - 1] = {
              ...msgs[msgs.length - 1],
              content: msgs[msgs.length - 1].content + chunk,
            };
          }
          return { messages: msgs };
        }),

      setLastMessageSources: (sources) =>
        set((s) => {
          const msgs = [...s.messages];
          if (msgs.length > 0) msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], sources };
          return { messages: msgs };
        }),

      setLastMessageEditProposal: (proposal) =>
        set((s) => {
          const msgs = [...s.messages];
          if (msgs.length > 0)
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], editProposal: proposal };
          return { messages: msgs };
        }),

      clearChat: () => set({ messages: [] }),
      setIsEmbedding:        (v) => set({ isEmbedding: v }),
      setIsChatLoading:      (v) => set({ isChatLoading: v }),
      setEmbeddingProgress:  (v) => set({ embeddingProgress: v }),
      setEmbeddingStatus:    (s) => set({ embeddingStatus: s }),
      setOllamaModel:        (m) => set({ ollamaModel: m }),
      setOllamaModels:  (models) => set({ ollamaModels: models }),
      setAbortController: (ctrl) => set({ abortController: ctrl }),
      setTotalChunksIndexed: (n) => set({ totalChunksIndexed: n }),

      stopGeneration: () => {
        const ctrl = get().abortController;
        if (ctrl) ctrl.abort();
        set({ isChatLoading: false, abortController: null });
      },

      clearAll: () =>
        set({
          files:              [],
          selectedFileId:     null,
          messages:           [],
          embeddingProgress:  0,
          embeddingStatus:    "",
          totalChunksIndexed: 0,
          abortController:    null,
        }),
    }),
    {
      name: "codemind-storage",
      version: 3,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Partial<AppState>;
        if (version < 2) state.ollamaModel = DEFAULT_MODEL;
        return state;
      },
      partialize: (state) => ({
        // Store file metadata + blobUrl but not content (it's in Blob now)
        files: state.files.map((f) => ({
          ...f,
          content: "", // content lives in Vercel Blob, not localStorage
        })),
        messages:           state.messages.slice(-50),
        ollamaModel:        state.ollamaModel,
        totalChunksIndexed: state.totalChunksIndexed,
      }),
    }
  )
);