import { Index } from "@upstash/vector";

export interface VectorChunk {
  id: string;
  fileId: string;
  fileName: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  chunkType: "function" | "class" | "module" | "block" | "text";
  importance: number;
}

export interface SearchResult {
  chunk: VectorChunk;
  score: number;
  weightedScore: number;
}

// Upstash Vector client — singleton
const globalForIndex = globalThis as unknown as { upstashIndex: Index | null };

function getIndex(): Index {
  if (!globalForIndex.upstashIndex) {
    globalForIndex.upstashIndex = new Index({
      url:   process.env.UPSTASH_VECTOR_REST_URL!,
      token: process.env.UPSTASH_VECTOR_REST_TOKEN!,
    });
  }
  return globalForIndex.upstashIndex;
}

export const vectorStore = {
  async addChunk(chunk: VectorChunk, embedding: number[]): Promise<void> {
    const index = getIndex();
    await index.upsert({
      id:       chunk.id,
      vector:   embedding,
      metadata: chunk as unknown as Record<string, unknown>,
    });
  },

  async removeByFileId(fileId: string): Promise<void> {
    const index = getIndex();
    // Fetch all vectors with this fileId and delete them
    const results = await index.query({
      vector:          new Array(384).fill(0),
      topK:            1000,
      includeMetadata: true,
      filter:          `fileId = '${fileId}'`,
    });
    const ids = results.map((r) => r.id as string).filter(Boolean);
    if (ids.length > 0) await index.delete(ids);
  },

  async search(queryEmbedding: number[], topK = 8): Promise<SearchResult[]> {
    const index = getIndex();
    const results = await index.query({
      vector:          queryEmbedding,
      topK:            topK * 2, // fetch more, re-rank by importance
      includeMetadata: true,
    });

    return results
      .map((r) => {
        const chunk = r.metadata as unknown as VectorChunk;
        const score = r.score ?? 0;
        const weightedScore = score * (chunk.importance || 1.0);
        return { chunk, score, weightedScore };
      })
      .sort((a, b) => b.weightedScore - a.weightedScore)
      .slice(0, topK);
  },

  async getAll(): Promise<VectorChunk[]> {
    const index = getIndex();
    const results = await index.query({
      vector:          new Array(384).fill(0),
      topK:            1000,
      includeMetadata: true,
    });
    return results.map((r) => r.metadata as unknown as VectorChunk);
  },

  async size(): Promise<number> {
    const index = getIndex();
    const info  = await index.info();
    return info.vectorCount ?? 0;
  },
};