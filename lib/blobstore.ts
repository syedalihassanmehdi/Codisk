import { put, del, list, getDownloadUrl } from "@vercel/blob";

export interface StoredFile {
  id: string;
  name: string;
  path: string;
  language: string;
  size: number;
  hash: string;
  importance: "high" | "medium" | "low";
  blobUrl: string;
  embedded: boolean;
}

export const blobStore = {
  // Upload file content to Vercel Blob
  async uploadFile(
    fileId: string,
    filePath: string,
    content: string
  ): Promise<string> {
    const blob = await put(`codisk/${fileId}/${filePath}`, content, {
      access:      "public",
      contentType: "text/plain",
      addRandomSuffix: false,
    });
    return blob.url;
  },

  // Fetch file content back from Vercel Blob
  async getContent(blobUrl: string): Promise<string> {
    const res = await fetch(blobUrl);
    if (!res.ok) throw new Error(`Failed to fetch file: ${res.statusText}`);
    return res.text();
  },

  // Delete a file from Vercel Blob
  async deleteFile(blobUrl: string): Promise<void> {
    await del(blobUrl);
  },

  // List all stored files (for a session/user prefix)
  async listFiles(prefix = "codisk/"): Promise<string[]> {
    const { blobs } = await list({ prefix });
    return blobs.map((b) => b.url);
  },
};