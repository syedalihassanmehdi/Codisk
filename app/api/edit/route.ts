import { NextRequest } from "next/server";
import { vectorStore } from "@/lib/vectorStore";
import { streamChat } from "@/lib/ollama";
import { truncateToTokens } from "@/utils/chunker";

const EDIT_SYSTEM = `You are an expert software engineer. The user wants to edit a file.
Return ONLY the complete updated file contents — no explanation, no markdown fences, no preamble.
Just the raw code, exactly as it should appear in the file after the edit.
Do not truncate or summarize. Return the ENTIRE file.`;

export async function POST(req: NextRequest) {
  try {
    const { filePath, fileContent, instruction, model = "llama-3.3-70b-versatile" } = await req.json();

    if (!filePath || !fileContent || !instruction) {
      return new Response("Missing filePath, fileContent, or instruction", { status: 400 });
    }

    // Pull relevant context from vector store for extra awareness
    const allChunks = vectorStore.getAll();
    const relatedChunks = allChunks
      .filter((c) => c.filePath !== filePath)
      .slice(0, 5)
      .map((c) => `### ${c.filePath}\n\`\`\`\n${c.content}\n\`\`\``)
      .join("\n\n");

    const context = relatedChunks
      ? `## Related files for context:\n${truncateToTokens(relatedChunks, 1500)}\n\n`
      : "";

    const prompt = `${context}## File to edit: ${filePath}
\`\`\`
${fileContent}
\`\`\`

## Edit instruction:
${instruction}

Return the complete updated file:`;

    const encoder  = new TextEncoder();
    const abortCtrl = new AbortController();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamChat(model, prompt, EDIT_SYSTEM, abortCtrl.signal)) {
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
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return new Response((err as Error).message || "Edit failed", { status: 500 });
  }
}