import type { UploadedFile } from "@/lib/store";

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileTreeNode[];
  fileId?: string;
  language?: string;
  size?: number;
  embedded?: boolean;
  importance?: "high" | "medium" | "low";
}

export function buildFileTree(files: UploadedFile[]): FileTreeNode[] {
  const root: FileTreeNode = { name: "", path: "", type: "dir", children: [] };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let node = root;

    // Walk/create directory nodes
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join("/");
      let dir = node.children!.find((c) => c.type === "dir" && c.name === parts[i]);
      if (!dir) {
        dir = { name: parts[i], path: dirPath, type: "dir", children: [] };
        node.children!.push(dir);
      }
      node = dir;
    }

    // Leaf file node
    node.children!.push({
      name: parts[parts.length - 1] || file.name,
      path: file.path,
      type: "file",
      fileId: file.id,
      language: file.language,
      size: file.size,
      embedded: file.embedded,
      importance: file.importance,
    });
  }

  sortTree(root.children!);
  return root.children!;
}

function sortTree(nodes: FileTreeNode[]) {
  nodes.sort((a, b) => {
    // Directories first
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    // High-importance files bubble up within their group
    const imp = { high: 0, medium: 1, low: 2, undefined: 1 };
    const aImp = imp[a.importance as keyof typeof imp] ?? 1;
    const bImp = imp[b.importance as keyof typeof imp] ?? 1;
    if (a.type === "file" && aImp !== bImp) return aImp - bImp;
    return a.name.localeCompare(b.name);
  });
  nodes.forEach((n) => n.children && sortTree(n.children));
}

/** Count total files (leaves) under a node */
export function countFiles(node: FileTreeNode): number {
  if (node.type === "file") return 1;
  return (node.children || []).reduce((acc, c) => acc + countFiles(c), 0);
}

/** Collect all file IDs under a directory node */
export function collectFileIds(node: FileTreeNode): string[] {
  if (node.type === "file") return node.fileId ? [node.fileId] : [];
  return (node.children || []).flatMap(collectFileIds);
}
