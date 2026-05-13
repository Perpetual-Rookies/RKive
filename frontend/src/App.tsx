import { useCallback, useEffect, useRef, useState } from "react";

type Role = "user" | "assistant" | "system";

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  streaming?: boolean;
};

function apiBase(): string {
  return import.meta.env.VITE_API_BASE ?? "";
}

function wsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const assistantIdRef = useRef<string | null>(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
        if (msg.type === "conversation" && typeof msg.id === "string") {
          setConversationId(msg.id);
          return;
        }
        if (msg.type === "token" && typeof msg.text === "string") {
          const aid = assistantIdRef.current;
          if (!aid) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aid
                ? { ...m, content: m.content + msg.text, streaming: true }
                : m,
            ),
          );
          return;
        }
        if (msg.type === "citations") {
          return;
        }
        if (msg.type === "done") {
          const aid = assistantIdRef.current;
          assistantIdRef.current = null;
          if (aid) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aid ? { ...m, streaming: false } : m,
              ),
            );
          }
          setBusy(false);
          return;
        }
        if (msg.type === "error") {
          assistantIdRef.current = null;
          setBusy(false);
          const text =
            typeof msg.message === "string" ? msg.message : "Unknown error";
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: `Error: ${text}`,
            },
          ]);
        }
      } catch {
        /* ignore */
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  const sendChat = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    setInput("");
    setBusy(true);
    const userId = crypto.randomUUID();
    const asstId = crypto.randomUUID();
    assistantIdRef.current = asstId;

    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: text },
      { id: asstId, role: "assistant", content: "", streaming: true },
    ]);

    ws.send(
      JSON.stringify({
        type: "chat",
        content: text,
        conversationId: conversationId ?? undefined,
      }),
    );
  }, [busy, conversationId, input]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".md")) {
      setUploadStatus("Please choose a .md file");
      return;
    }
    setUploadStatus("Uploading…");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${apiBase()}/api/upload`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setUploadStatus(
          typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
        );
        return;
      }
      const chunks = data.chunks;
      setUploadStatus(
        `Ingested OK (${typeof chunks === "number" ? chunks : "?"} chunks)`,
      );
    } catch (err) {
      setUploadStatus(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        maxWidth: 720,
        margin: "0 auto",
        padding: "1.25rem",
      }}
    >
      <header style={{ marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 600, margin: 0 }}>
          RKive
        </h1>
        <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
          Org knowledge chat · Markdown upload
        </p>
        <p className="mono" style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          {connected ? "● connected" : "○ disconnected"}
        </p>
      </header>

      <section
        style={{
          padding: "0.75rem 1rem",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          marginBottom: "1rem",
        }}
      >
        <label
          style={{
            display: "inline-block",
            cursor: "pointer",
            padding: "0.45rem 0.85rem",
            background: "var(--accent-dim)",
            borderRadius: 8,
            fontSize: "0.875rem",
            fontWeight: 600,
          }}
        >
          Upload markdown
          <input
            type="file"
            accept=".md,text/markdown"
            style={{ display: "none" }}
            onChange={onUpload}
          />
        </label>
        {uploadStatus && (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>{uploadStatus}</p>
        )}
      </section>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.65rem",
          paddingBottom: "0.5rem",
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            Ask a question about ingested documents, or upload a .md file first.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "92%",
              padding: "0.65rem 0.85rem",
              borderRadius: 12,
              background:
                m.role === "user" ? "var(--user-bubble)" : "var(--assistant-bubble)",
              border: "1px solid var(--border)",
              whiteSpace: "pre-wrap",
              fontSize: "0.92rem",
            }}
          >
            {m.content || (m.streaming ? "…" : "")}
          </div>
        ))}
      </div>

      <footer
        style={{
          display: "flex",
          gap: "0.5rem",
          paddingTop: "0.75rem",
          borderTop: "1px solid var(--border)",
        }}
      >
        <input
          type="text"
          value={input}
          disabled={!connected || busy}
          placeholder={connected ? "Ask something…" : "Connecting…"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendChat();
            }
          }}
          style={{
            flex: 1,
            padding: "0.65rem 0.85rem",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            fontSize: "0.95rem",
          }}
        />
        <button
          type="button"
          disabled={!connected || busy || !input.trim()}
          onClick={sendChat}
          style={{
            padding: "0 1rem",
            borderRadius: 10,
            border: "none",
            background: "var(--accent)",
            color: "#0a0e14",
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          Send
        </button>
      </footer>
    </div>
  );
}
