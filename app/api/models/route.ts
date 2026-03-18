import { NextResponse } from "next/server";
import { listModels, checkOllama } from "@/lib/ollama";

const CODE_KW  = ["coder", "code", "starcoder", "deepseek", "codellama", "wizard", "qwen"];
const EMBED_KW = ["embed", "nomic", "mxbai", "all-minilm", "bge"];

function classifyModel(name: string): "chat" | "code" | "embed" {
  const n = name.toLowerCase();
  if (EMBED_KW.some((k) => n.includes(k))) return "embed";
  if (CODE_KW.some((k) => n.includes(k))) return "code";
  return "chat";
}

export async function GET() {
  const online = await checkOllama();
  if (!online) {
    return NextResponse.json({ models: [], status: "offline" });
  }

  const raw = await listModels();
  const models = raw.map((m) => ({
    ...m,
    type: classifyModel(m.name),
  }));

  return NextResponse.json({ models, status: "online" });
}