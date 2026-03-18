import { NextRequest } from "next/server";
import { vectorStore } from "@/lib/vectorStore";
import { streamChat } from "@/lib/ollama";
import { truncateToTokens } from "@/utils/chunker";

const ANALYSIS_PROMPTS = {
  explain: {
    user: "Explain the entire project",
    system: `You are analyzing a complete codebase. Provide a thorough, structured explanation:

## 1. Project Purpose
What does this project do? Who is it for?

## 2. Architecture Overview
How is it structured? What patterns are used?

## 3. Core Files & Their Roles
List the most important files and explain what each does.

## 4. Data Flow
How does data move through the system?

## 5. Tech Stack
List all technologies, frameworks, and libraries used.

## 6. Key Design Decisions
What are notable design choices in this codebase?

Be specific — reference actual file paths and function names.`,
  },
  bugs: {
    user: "Find all bugs and issues in the codebase",
    system: `You are a senior security engineer. Audit the codebase and report ALL issues.

Format each issue like this:

---
**[SEVERITY: CRITICAL|HIGH|MEDIUM|LOW]** \`path/to/file.ts:line\`
**Type:** Bug | Security | Performance | Code Quality
**Issue:** One-line description
**Detail:** Explain the problem
**Fix:** Concrete fix with code example
---

Be exhaustive. If the code is clean, say so.`,
  },
  docs: {
    user: "Generate complete documentation for this project",
    system: `You are a technical writer. Generate a complete README.md.

# [Project Name]
> One-line description

## ✨ Features
## 🛠 Tech Stack
## 📁 Project Structure
## 🚀 Getting Started
## 📖 Usage
## 🔌 API Reference
## 🏗 Architecture
## 🤝 Contributing
## 📄 License

Base everything on actual code. Be accurate.`,
  },
};

export async function POST(req: NextRequest) {
  try {
    const { type, model = "llama-3.3-70b-versatile" } = await req.json();

    if (!ANALYSIS_PROMPTS[type as keyof typeof ANALYSIS_PROMPTS]) {
      return new Response("Invalid analysis type", { status: 400 });
    }

    const allChunks = await vectorStore.getAll();

    if (allChunks.length === 0) {
      const encoder = new TextEncoder();
      const stream  = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type:  "error",
                error: "No files indexed yet. Upload and click 'Index Files' first.",
              }) + "\n"
            )
          );
          controller.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    }

    const highChunks = allChunks
      .filter((c) => c.importance >= 1.4)
      .slice(0, 15);

    const mediumChunks = allChunks
      .filter((c) => c.importance >= 0.9 && c.importance < 1.4)
      .filter((c, i, arr) => !arr.slice(0, i).some((p) => p.filePath === c.filePath))
      .slice(0, 15);

    const selectedChunks = [...highChunks, ...mediumChunks];

    const byFile = new Map<string, string[]>();
    for (const chunk of selectedChunks) {
      if (!byFile.has(chunk.filePath)) byFile.set(chunk.filePath, []);
      byFile.get(chunk.filePath)!.push(chunk.content);
    }

    const contextParts: string[] = [];
    for (const [filePath, contents] of Array.from(byFile)) {
      contextParts.push(
        `### 📄 ${filePath}\n\`\`\`\n${contents.join("\n\n// ...\n\n")}\n\`\`\``
      );
    }

    const context = truncateToTokens(contextParts.join("\n\n"), 7000);
    const { system, user } = ANALYSIS_PROMPTS[type as keyof typeof ANALYSIS_PROMPTS];
    const prompt  = `## Codebase Context\n\n${context}\n\n---\nTask: ${user}\n\nResponse:`;

    const encoder   = new TextEncoder();
    const abortCtrl = new AbortController();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamChat(model, prompt, system, abortCtrl.signal)) {
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
  } catch (err) {
    return new Response((err as Error).message || "Analysis failed", { status: 500 });
  }
}