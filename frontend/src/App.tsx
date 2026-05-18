import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { ReactNode } from "react";
import Files from "./Files";
import rsystemsLogo from "./assets/rsystems-logo-white.svg";

type Role = "user" | "assistant" | "system";

type AppRole = "Standard Employee" | "Sales Representative";

type Visibility = "Org Level (Public)" | "Sales Project (Private)";

type Citation = {
  documentId: string;
  sourcePath: string;
  score: number;
  filename: string;
};

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  streaming?: boolean;
  citations?: Citation[];
};

const ROLE_OPTIONS: AppRole[] = ["Standard Employee", "Sales Representative"];

const VISIBILITY_OPTIONS: Visibility[] = [
  "Org Level (Public)",
  "Sales Project (Private)",
];

function apiBase(): string {
  return import.meta.env.VITE_API_BASE ?? "";
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function renderAssistantContent(content: string): ReactNode {
  const lines = content
    .split("\n")
    .map((line) => line.trimEnd());

  const nodes: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    nodes.push(
      <ul key={`list-${nodes.length}`} className="message-list">
        {listItems.map((item, index) => (
          <li key={index}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);

    if (bulletMatch) {
      listItems.push(bulletMatch[1]);
      return;
    }

    flushList();

    if (!trimmed) {
      return;
    }

    nodes.push(
      <p key={`p-${nodes.length}`} className="message-paragraph">
        {renderInlineMarkdown(trimmed)}
      </p>,
    );
  });

  flushList();

  if (nodes.length === 0) {
    return content;
  }

  return nodes;
}

export default function App() {
  const [page, setPage] = useState<"chat" | "files">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const connected = true;
  const [busy, setBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [role, setRole] = useState<AppRole>(ROLE_OPTIONS[0]);
  const [visibility, setVisibility] = useState<Visibility>(VISIBILITY_OPTIONS[0]);
  const assistantIdRef = useRef<string | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const existing = params.get("conversation");
    if (existing) {
      setConversationId(existing);
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (conversationId) {
      url.searchParams.set("conversation", conversationId);
    } else {
      url.searchParams.delete("conversation");
    }
    window.history.replaceState({}, "", url);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || messages.length > 0) return;
    let active = true;
    const loadHistory = async () => {
      setHistoryLoading(true);
      try {
        const res = await fetch(`${apiBase()}/api/conversations/${conversationId}/messages`);
        if (!res.ok) {
          throw new Error(`Failed to load conversation (${res.status})`);
        }
        const data = (await res.json()) as { messages?: Array<{ role: Role; content: string }> };
        if (!active) return;
        const restored = (data.messages ?? []).map((msg) => ({
          id: crypto.randomUUID(),
          role: msg.role,
          content: msg.content,
          streaming: false,
        }));
        setMessages(restored);
      } catch (err) {
        if (active) {
          setMessages((prev) =>
            prev.length === 0
              ? [
                  {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: err instanceof Error ? err.message : String(err),
                  },
                ]
              : prev,
          );
        }
      } finally {
        if (active) {
          setHistoryLoading(false);
        }
      }
    };
    void loadHistory();
    return () => {
      active = false;
    };
  }, [conversationId, messages.length]);

  useEffect(() => {
    const chatList = chatListRef.current;
    if (!chatList) return;
    chatList.scrollTo({
      top: chatList.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const handleStreamMessage = useCallback((msg: Record<string, unknown>) => {
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
      const aid = assistantIdRef.current;
      const rawCitations = Array.isArray(msg.citations)
        ? msg.citations
            .map((citation) => {
              if (!citation || typeof citation !== "object") {
                return null;
              }
              const record = citation as Record<string, unknown>;
              const documentId =
                typeof record.documentId === "string" ? record.documentId : "";
              const sourcePath =
                typeof record.sourcePath === "string" ? record.sourcePath : "";
              const filename =
                typeof record.filename === "string" ? record.filename : "";
              const score =
                typeof record.score === "number" ? record.score : Number(record.score ?? 0);

              if (!documentId && !sourcePath) {
                return null;
              }

              return {
                documentId,
                sourcePath,
                filename,
                score: Number.isFinite(score) ? score : 0,
              } satisfies Citation;
            })
            .filter((citation): citation is Citation => citation !== null)
        : [];

      const citations = Array.from(
        rawCitations
          .reduce((map, citation) => {
            const key = `${citation.filename}|${citation.sourcePath}|${citation.documentId}`;
            const existing = map.get(key);
            if (!existing || citation.score > existing.score) {
              map.set(key, citation);
            }
            return map;
          }, new Map<string, Citation>())
          .values(),
      );

      if (aid) {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === aid ? { ...message, citations } : message,
          ),
        );
      }
      return;
    }
    if (msg.type === "done") {
      const aid = assistantIdRef.current;
      assistantIdRef.current = null;
      if (aid) {
        setMessages((prev) =>
          prev.map((m) => (m.id === aid ? { ...m, streaming: false } : m)),
        );
      }
      setBusy(false);
      return;
    }
    if (msg.type === "error") {
      const aid = assistantIdRef.current;
      assistantIdRef.current = null;
      setBusy(false);
      const text = typeof msg.message === "string" ? msg.message : "Unknown error";
      if (aid) {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === aid
              ? { ...message, content: `Error: ${text}`, streaming: false }
              : message,
          ),
        );
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Error: ${text}`,
          },
        ]);
      }
    }
  }, []);

  const sendChat = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

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

    try {
      const res = await fetch(`${apiBase()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "chat",
          content: text,
          conversationId: conversationId ?? undefined,
          role,
          visibility,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Chat request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 2);
          const lines = chunk.split("\n");
          const dataLine = lines.find((line) => line.startsWith("data: "));
          if (dataLine) {
            const payload = dataLine.slice(6);
            try {
              const msg = JSON.parse(payload) as Record<string, unknown>;
              handleStreamMessage(msg);
            } catch {
              /* ignore */
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (err) {
      handleStreamMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [busy, conversationId, handleStreamMessage, input, role, visibility]);

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith(".md") && !name.endsWith(".pdf")) {
      setUploadStatus("Please choose a .md or .pdf file");
      return;
    }
    setUploadStatus("Uploading…");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("visibility", visibility);
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

  const formatCitationName = (citation: Citation) => {
    const candidate =
      citation.filename?.trim() || citation.sourcePath?.trim() || citation.documentId;
    const pieces = candidate.split(/[\\/]/);
    return pieces[pieces.length - 1] || candidate || citation.documentId;
  };

  const formatCitationScore = (score: number) => {
    if (!Number.isFinite(score)) return "0%";
    return `${Math.max(0, Math.min(100, Math.round(score * 100)))}%`;
  };

  if (page === "files") {
    return (
      <div className="app-wrapper">
        <Files onBack={() => setPage("chat")} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark brand-logo">
            <img src={rsystemsLogo} alt="Rsystems" />
          </div>
          <div>
            <h1 className="brand-title">RKive</h1>
            <p className="brand-copy">Grounded internal knowledge chat</p>
          </div>
        </div>

        <section className="sidebar-section">
          <div className="section-heading">
            <span>Logged in as</span>
            <span className={`status-pill ${connected ? "is-online" : "is-offline"}`}>
              <span className="status-dot" />
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <label className="field-label" htmlFor="role-select">
            Role
          </label>
          <select
            id="role-select"
            className="select"
            value={role}
            onChange={(e) => setRole(e.target.value as AppRole)}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </section>

        <div className="sidebar-divider" />

        <section className="sidebar-section">
          <div className="section-heading">
            <span>Document upload</span>
            <span className="helper-chip">Markdown, PDF</span>
          </div>
          <p className="section-copy">
            Upload knowledge content and choose the visibility scope before ingesting.
          </p>
          <label className="field-label" htmlFor="visibility-select">
            Visibility
          </label>
          <select
            id="visibility-select"
            className="select"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as Visibility)}
          >
            {VISIBILITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <label className="upload-button" htmlFor="document-upload">
            Choose document
          </label>
          <input
            id="document-upload"
            type="file"
            accept=".md,.pdf,text/markdown,application/pdf"
            className="file-input"
            onChange={onUpload}
          />

          {uploadStatus && <p className="upload-status">{uploadStatus}</p>}
          <p className="upload-note">Files are sent with the selected visibility.</p>
        </section>

        <div className="sidebar-divider" />

        <section className="sidebar-section">
          <button 
            className="files-nav-button"
            onClick={() => setPage("files")}
          >
            📁 Manage Documents
          </button>
          <p className="section-copy">
            View, organize, and delete your uploaded documents.
          </p>
        </section>
      </aside>

      <main className="panel">
        <header className="panel-topbar">
          <div>
            <p className="eyebrow">Knowledge workspace</p>
            <h2>Ask RKive about uploaded documents</h2>
          </div>
          <p className="panel-meta mono">
            {conversationId ? `Conversation ${conversationId.slice(0, 8)}` : "New conversation"}
          </p>
        </header>

        <section className="chat-shell">
          <div ref={chatListRef} className="chat-list">
            {messages.length === 0 && !historyLoading && (
              <div className="empty-state">
                <p className="empty-title">Ready when you are</p>
                <p className="empty-copy">
                  Upload a document on the left, then ask a grounded question here.
                </p>
              </div>
            )}

            {messages.length === 0 && historyLoading && (
              <div className="empty-state">
                <p className="empty-title">Loading conversation...</p>
                <p className="empty-copy">Restoring your recent messages.</p>
              </div>
            )}

            {messages.map((message) => {
              const isUser = message.role === "user";
              const isAssistant = message.role === "assistant";
              const citations = message.citations ?? [];

              return (
                <div
                  key={message.id}
                  className={`message-row ${isUser ? "is-user" : "is-assistant"}`}
                >
                  <div className={`message-card ${isUser ? "is-user" : "is-assistant"}`}>
                    {isAssistant && <span className="message-label">RKive</span>}
                    {isUser && <span className="message-label">You</span>}
                    <div className="message-content">
                      {isAssistant ? renderAssistantContent(message.content) : message.content}
                      {message.streaming && (
                        <span className="typing-indicator" aria-label="Streaming response">
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                        </span>
                      )}
                    </div>

                    {isAssistant && !message.streaming && citations.length > 0 && (
                      <div className="citation-row">
                        {citations.map((citation, index) => (
                          <a
                            key={`${citation.documentId}-${index}`}
                            href={`${apiBase()}/api/documents/${citation.documentId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="citation-pill"
                          >
                            <span className="citation-name">[{index + 1}] {formatCitationName(citation)}</span>
                            <span className="citation-score">({formatCitationScore(citation.score)})</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              sendChat();
            }}
          >
            <input
              type="text"
              value={input}
              disabled={!connected || busy}
              placeholder={connected ? "Ask something grounded…" : "Connecting to RKive…"}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              className="composer-input"
            />
            <button
              type="submit"
              className="composer-button"
              disabled={!connected || busy || !input.trim()}
            >
              Send
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
