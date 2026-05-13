const ollamaBase = () => {
  const u = process.env.OLLAMA_BASE_URL;
  if (!u) throw new Error("OLLAMA_BASE_URL is required");
  return u.replace(/\/$/, "");
};

export function chatModel(): string {
  return process.env.OLLAMA_CHAT_MODEL ?? "llama3.2";
}

export function embedModel(): string {
  return process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
}

export async function ollamaEmbed(text: string): Promise<number[]> {
  const res = await fetch(`${ollamaBase()}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: embedModel(),
      prompt: text,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama embeddings failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { embedding?: number[] };
  if (!data.embedding?.length) throw new Error("Ollama returned no embedding");
  return data.embedding;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function* ollamaChatStream(
  messages: ChatMessage[],
): AsyncGenerator<string> {
  const res = await fetch(`${ollamaBase()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: chatModel(),
      messages,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const t = await res.text();
    throw new Error(`Ollama chat failed: ${res.status} ${t}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const j = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean };
        if (j.message?.content) yield j.message.content;
      } catch {
        // ignore parse errors for incomplete chunks
      }
    }
  }
}
