const GROQ_BASE = "https://api.groq.com/openai/v1";
const GROQ_KEY  = process.env.GROQ_API_KEY || "";

export async function getEmbedding(text: string, _model?: string): Promise<number[]> {
  const vec = new Array(384).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % 384] += text.charCodeAt(i);
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / mag);
}

export async function getBatchEmbeddings(texts: string[], model?: string): Promise<number[][]> {
  return Promise.all(texts.map(t => getEmbedding(t, model)));
}

export async function* streamChat(
  model: string,
  prompt: string,
  system?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_KEY}`,
    },
    signal,
    body: JSON.stringify({
      model,  // ← use the passed-in model, not a hardcoded string
      messages: [
        { role: "system", content: system || "You are an expert code assistant." },
        { role: "user",   content: prompt },
      ],
      stream: true,
      temperature: 0.2,
      max_tokens: 3072,
    }),
  });

  if (!res.ok) throw new Error(`Groq error: ${await res.text()}`);

  const reader  = res.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split("\n").filter(l => l.startsWith("data: "));
    for (const line of lines) {
      const data = line.slice(6);
      if (data === "[DONE]") return;
      try {
        const json  = JSON.parse(data);
        const token = json.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch { /* skip */ }
    }
  }
}

export interface ModelDetails { name: string; size: number; parameterSize?: string; family?: string; }

export async function listModels(): Promise<ModelDetails[]> {
  return [
    { name: "llama-3.3-70b-versatile",                    size: 0, parameterSize: "70B" },
    { name: "llama-3.1-8b-instant",                       size: 0, parameterSize: "8B"  },
    { name: "openai/gpt-oss-120b",                        size: 0, parameterSize: "120B" },
    { name: "meta-llama/llama-4-scout-17b-16e-instruct",  size: 0, parameterSize: "17B" },
    { name: "qwen/qwen3-32b",                             size: 0, parameterSize: "32B"  },
  ];
}

export async function checkOllama(): Promise<boolean> {
  return !!GROQ_KEY;
}