import { NextRequest } from "next/server";
import { vectorStore } from "@/lib/vectorStore";
import { getEmbedding, streamChat } from "@/lib/ollama";
import { truncateToTokens } from "@/utils/chunker";

const SYSTEM_PROMPT = `You are CodeMind, an elite software engineer and code reviewer embedded inside a developer's IDE.
You have been given semantic excerpts from a codebase as context.
Rules:
- Reference specific file paths and line numbers when answering
- Use markdown with fenced code blocks
- Be precise and actionable
- If asked to find bugs, be exhaustive
- If the context doesn't contain the answer, say so clearly
- Do NOT hallucinate code that isn't in the context`;

const DEFAULT_MODEL = "llama-3.3-70b-versatile";

export async function POST(req: NextRequest) {
  try {
    const {
      question,
      model = DEFAULT_MODEL,
      embedModel,
      history = [],
      topK = 8,
    } = await req.json();

    if (!question) return new Response("No question provided", { status: 400 });

    let contextBlock = "";
    let sources: string[] = [];

    const storeSize = await vectorStore.size();
    if (storeSize > 0) {
      const queryEmbedding = await getEmbedding(question, embedModel);
      const results        = await vectorStore.search(queryEmbedding, topK);

      if (results.length > 0) {
        const seen    = new Set<string>();
        const deduped = results.filter((r) => {
          const key = `${r.chunk.filePath}:${r.chunk.startLine}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        sources = Array.from(new Set(deduped.map((r) => r.chunk.filePath)));

        const merged = deduped
          .sort((a, b) => a.chunk.filePath.localeCompare(b.chunk.filePath))
          .map(
            (r) =>
              `### ${r.chunk.filePath} (lines ${r.chunk.startLine}-${r.chunk.endLine}) [${r.chunk.chunkType}] relevance: ${(r.weightedScore * 100).toFixed(0)}%\n\`\`\`\n${r.chunk.content}\n\`\`\``
          )
          .join("\n\n");

        contextBlock = truncateToTokens(merged, 5000);
      }
    }

    const historyStr = history
      .slice(-6)
      .map((m: { role: string; content: string }) =>
        `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`
      )
      .join("\n");

    const prompt = contextBlock
      ? `${historyStr ? historyStr + "\n\n" : ""}## Relevant Code Context\n\n${contextBlock}\n\n---\nHuman: ${question}\nAssistant:`
      : `${historyStr ? historyStr + "\n\n" : ""}Human: ${question}\nAssistant:`;

    const encoder   = new TextEncoder();
    const abortCtrl = new AbortController();

    const stream = new ReadableStream({
      async start(controller) {
        if (sources.length > 0) {
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "sources", sources }) + "\n")
          );
        }
        try {
          for await (const chunk of streamChat(model, prompt, SYSTEM_PROMPT, abortCtrl.signal)) {
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: "token", token: chunk }) + "\n")
            );
          }
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({ type: "error", error: (err as Error).message }) + "\n"
              )
            );
          }
        }
        controller.close();
      },
      cancel() { abortCtrl.abort(); },
    });

    return new Response(stream, {
      headers: {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        Connection:      "keep-alive",
      },
    });
  } catch (err: unknown) {
    return new Response((err as Error).message || "Chat failed", { status: 500 });
  }
}