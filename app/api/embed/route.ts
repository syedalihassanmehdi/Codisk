import { NextRequest, NextResponse } from "next/server";
import { vectorStore } from "@/lib/vectorStore";
import { blobStore } from "@/lib/blobStore";
import { getBatchEmbeddings } from "@/lib/ollama";
import { chunkCode, importanceWeight, generateId } from "@/utils/chunker";

export async function POST(req: NextRequest) {
  try {
    const { file, model } = await req.json();
    if (!file?.id) {
      return NextResponse.json({ error: "Invalid file data" }, { status: 400 });
    }

    // Fetch content — from client payload or from Vercel Blob
    let content: string = file.content;
    if (!content && file.blobUrl) {
      content = await blobStore.getContent(file.blobUrl);
    }
    if (!content) {
      return NextResponse.json({ error: "No content available" }, { status: 400 });
    }

    // Remove old chunks for this file before re-indexing
    await vectorStore.removeByFileId(file.id);

    const chunks = chunkCode(content, file.language);
    const weight = importanceWeight(file.importance || "medium");

    const texts = chunks.map(
      (c) =>
        `File: ${file.path || file.name}\nType: ${c.type}${c.name ? ` — ${c.name}` : ""}\nLines: ${c.startLine}-${c.endLine}\n\n${c.content}`
    );

    const embeddings = await getBatchEmbeddings(texts, model);

    // Write each chunk to Upstash Vector
    await Promise.all(
      chunks.map((chunk, i) => {
        const vectorChunk = {
          id:        generateId(),
          fileId:    file.id,
          fileName:  file.name,
          filePath:  file.path || file.name,
          content:   chunk.content,
          startLine: chunk.startLine,
          endLine:   chunk.endLine,
          chunkType: chunk.type,
          importance: weight,
        };
        return vectorStore.addChunk(vectorChunk, embeddings[i]);
      })
    );

    const total = await vectorStore.size();

    return NextResponse.json({
      success:       true,
      fileId:        file.id,
      chunksEmbedded: chunks.length,
      totalChunks:   total,
    });
  } catch (err) {
    console.error("Embed error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { fileId, blobUrl } = await req.json();

    await vectorStore.removeByFileId(fileId);
    if (blobUrl) await blobStore.deleteFile(blobUrl);

    const total = await vectorStore.size();
    return NextResponse.json({ success: true, totalChunks: total });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}