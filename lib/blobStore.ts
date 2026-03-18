import { put, del, list } from "@vercel/blob";

export const blobStore = {
  async uploadFile(
    fileId: string,
    filePath: string,
    content: string
  ): Promise<string> {
    const blob = await put(`codisk/${fileId}/${filePath}`, content, {
      access: "public",
      contentType: "text/plain",
      addRandomSuffix: false,
    });
    return blob.url;
  },

  async getContent(blobUrl: string): Promise<string> {
    const res = await fetch(blobUrl);
    if (!res.ok) throw new Error(`Failed to fetch file: ${res.statusText}`);
    return res.text();
  },

  async deleteFile(blobUrl: string): Promise<void> {
    await del(blobUrl);
  },

  async listFiles(prefix = "codisk/"): Promise<string[]> {
    const { blobs } = await list({ prefix });
    return blobs.map((b) => b.url);
  },
};