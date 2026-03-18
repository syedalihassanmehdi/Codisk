import { NextRequest, NextResponse } from "next/server";
import { blobStore } from "@/lib/blobStore";
import { getLanguage, generateId, hashContent, scoreFileImportance } from "@/utils/chunker";

const ALLOWED_EXTENSIONS = new Set([
  "js","ts","jsx","tsx","py","html","css","scss","json","md","txt",
  "vue","go","rs","java","cpp","c","rb","php","yaml","yml","toml","sh",
  "env","gitignore","prisma","graphql","sql",
]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const TRUNCATE_SIZE = 2 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const rawFiles = formData.getAll("files") as File[];
    const rawPaths = formData.getAll("paths") as string[];

    if (!rawFiles.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const processed = [];
    const skipped: string[] = [];

    for (let i = 0; i < rawFiles.length; i++) {
      const file     = rawFiles[i];
      const filePath = rawPaths[i] || file.name;
      const fileName = filePath.split("/").pop() || file.name;
      const ext      = fileName.split(".").pop()?.toLowerCase() || "";

      if (!ALLOWED_EXTENSIONS.has(ext)) {
        skipped.push(`${fileName} (unsupported type)`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        skipped.push(`${fileName} (too large >5MB)`);
        continue;
      }

      let content = await file.text();

      if (file.size > TRUNCATE_SIZE) {
        const lines = content.split("\n");
        content = lines.slice(0, 800).join("\n") + "\n// [File truncated — too large]";
      }

      const id         = generateId();
      const hash       = hashContent(content);
      const importance = scoreFileImportance(filePath, content);

      // Upload content to Vercel Blob for persistence
      const blobUrl = await blobStore.uploadFile(id, filePath, content);

      processed.push({
        id,
        name:     fileName,
        path:     filePath,
        content,           // still send content to client for display
        language: getLanguage(fileName),
        size:     file.size,
        embedded: false,
        hash,
        importance,
        blobUrl,           // store the blob URL for later retrieval
      });
    }

    return NextResponse.json({ files: processed, skipped });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}