import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";
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

type DocumentInfo = {
  id: string;
  filename: string;
  created_at: string | null;
  file_type: "Markdown" | "PDF";
  visibility: string;
};

const ROLE_OPTIONS: AppRole[] = ["Standard Employee", "Sales Representative"];
const VISIBILITY_OPTIONS: Visibility[] = [
  "Org Level (Public)",
  "Sales Project (Private)",
];

const QUICK_PROMPTS = [
  "Summarize our customer support policy.",
  "What service levels are defined?",
  "Compare the company overview and case studies.",
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
  const lines = content.split("\n").map((line) => line.trimEnd());
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

    if (!trimmed) return;

    nodes.push(
      <p key={`p-${nodes.length}`} className="message-paragraph">
        {renderInlineMarkdown(trimmed)}
      </p>,
    );
  });

  flushList();

  return nodes.length === 0 ? content : nodes;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Unknown";
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function roleDescription(role: AppRole): string {
  return role === "Sales Representative"
    ? "Access to org-wide and sales-private content."
    : "Access to org-wide public content only.";
}

function roleScope(role: AppRole): string {
  return role === "Sales Representative"
    ? "Org knowledge + sales-private sources"
    : "Org-level public sources only";
}

export default function App() {
  const [page, setPage] = useState<"chat" | "files">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [role, setRole] = useState<AppRole>(ROLE_OPTIONS[0]);
  const [visibility, setVisibility] = useState<Visibility>(VISIBILITY_OPTIONS[0]);
  const assistantIdRef = useRef<string | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const connected = true;

  const loadDocuments = useCallback(async () => {
    try {
      setDocumentsLoading(true);
      const res = await fetch(`${apiBase()}/api/documents`);
      if (!res.ok) {
        throw new Error(`Failed to load documents (${res.status})`);
      }
      const data = (await res.json()) as { documents?: DocumentInfo[] };
      setDocuments(data.documents ?? []);
    } catch {
      setDocuments([]);
    } finally {
      setDocumentsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

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
        const data = (await res.json()) as {
          messages?: Array<{ role: Role; content: string }>;
        };
        if (!active) return;
        setMessages(
          (data.messages ?? []).map((msg) => ({
            id: crypto.randomUUID(),
            role: msg.role,
            content: msg.content,
            streaming: false,
          })),
        );
      } catch (err) {
        if (!active) return;
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
    chatList.scrollTo({ top: chatList.scrollHeight, behavior: "smooth" });
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
        prev.map((message) =>
          message.id === aid
            ? { ...message, content: message.content + msg.text, streaming: true }
            : message,
        ),
      );
      return;
    }

    if (msg.type === "citations") {
      const aid = assistantIdRef.current;
      const rawCitations = Array.isArray(msg.citations)
        ? msg.citations
            .map((citation) => {
              if (!citation || typeof citation !== "object") return null;
              const record = citation as Record<string, unknown>;
              const documentId =
                typeof record.documentId === "string" ? record.documentId : "";
              const sourcePath =
                typeof record.sourcePath === "string" ? record.sourcePath : "";
              const filename =
                typeof record.filename === "string" ? record.filename : "";
              const score =
                typeof record.score === "number" ? record.score : Number(record.score ?? 0);

              if (!documentId && !sourcePath) return null;

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

      if (!aid) return;
      setMessages((prev) =>
        prev.map((message) => (message.id === aid ? { ...message, citations } : message)),
      );
      return;
    }

    if (msg.type === "done") {
      const aid = assistantIdRef.current;
      assistantIdRef.current = null;
      if (aid) {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === aid ? { ...message, streaming: false } : message,
          ),
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
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Error: ${text}`,
        },
      ]);
    }
  }, []);

  const sendChat = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

    setInput("");
    setBusy(true);

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    assistantIdRef.current = assistantId;

    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: text },
      { id: assistantId, role: "assistant", content: "", streaming: true },
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
            try {
              handleStreamMessage(JSON.parse(dataLine.slice(6)) as Record<string, unknown>);
            } catch {
              // Ignore malformed stream chunks.
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

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const name = file.name.toLowerCase();
    if (!name.endsWith(".md") && !name.endsWith(".pdf")) {
      setUploadStatus("Please choose a .md or .pdf file.");
      return;
    }

    setUploadStatus("Uploading and indexing...");
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
        const detail =
          typeof data.error === "string"
            ? data.error
            : typeof data.detail === "string"
              ? data.detail
              : `HTTP ${res.status}`;
        setUploadStatus(detail);
        return;
      }

      const chunks = typeof data.chunks === "number" ? data.chunks : "?";
      const deduplicated = data.deduplicated === true ? " Existing file refreshed." : "";
      setUploadStatus(`Indexed ${chunks} chunks.${deduplicated}`);
      void loadDocuments();
    } catch (err) {
      setUploadStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendChat();
    }
  };

  const applyPrompt = (prompt: string) => {
    setInput(prompt);
  };

  const formatCitationName = (citation: Citation) => {
    const candidate =
      citation.filename?.trim() || citation.sourcePath?.trim() || citation.documentId;
    const pieces = candidate.split(/[\\/]/);
    return pieces[pieces.length - 1] || candidate || citation.documentId;
  };

  const formatCitationScore = (score: number) => {
    if (!Number.isFinite(score)) return "0%";
    return `${Math.max(0, Math.min(100, Math.round(score * 100)))}% match`;
  };

  const documentStats = useMemo(() => {
    const publicDocs = documents.filter((doc) => doc.visibility === VISIBILITY_OPTIONS[0]).length;
    const privateDocs = documents.filter((doc) => doc.visibility === VISIBILITY_OPTIONS[1]).length;
    const pdfs = documents.filter((doc) => doc.file_type === "PDF").length;
    const markdown = documents.length - pdfs;

    return { publicDocs, privateDocs, pdfs, markdown };
  }, [documents]);

  const recentDocuments = useMemo(
    () =>
      [...documents]
        .sort((a, b) => {
          const left = a.created_at ? new Date(a.created_at).getTime() : 0;
          const right = b.created_at ? new Date(b.created_at).getTime() : 0;
          return right - left;
        })
        .slice(0, 3),
    [documents],
  );

  if (page === "files") {
    return (
      <div className="app-wrapper">
        <Files onBack={() => setPage("chat")} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="workspace-sidebar">
        <div className="brand-block">
          <div className="brand-mark brand-logo">
            <img src={rsystemsLogo} alt="Rsystems" />
          </div>
          <div>
            <h1 className="brand-title">RKive</h1>
            <p className="brand-copy">Internal knowledge assistant</p>
          </div>
        </div>

        <section className="sidebar-card">
          <div className="section-heading">
            <span>Profile</span>
            <span className="status-pill is-online">
              <span className="status-dot" />
              {connected ? "Connected" : "Offline"}
            </span>
          </div>
          <label className="field-label" htmlFor="role-select">
            Role
          </label>
          <select
            id="role-select"
            className="select"
            value={role}
            onChange={(event) => setRole(event.target.value as AppRole)}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <p className="section-copy">{roleDescription(role)}</p>
          <div className="scope-banner">
            <span className="scope-label">Scope</span>
            <strong>{roleScope(role)}</strong>
          </div>
        </section>

        <section className="sidebar-card">
          <div className="section-heading">
            <span>Upload</span>
            <button className="link-button" onClick={() => setPage("files")} type="button">
              Documents
            </button>
          </div>
          <label className="field-label" htmlFor="visibility-select">
            Visibility
          </label>
          <select
            id="visibility-select"
            className="select"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as Visibility)}
          >
            {VISIBILITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <label className="upload-button" htmlFor="document-upload">
            Upload knowledge document
          </label>
          <input
            id="document-upload"
            type="file"
            accept=".md,.pdf,text/markdown,application/pdf"
            className="file-input"
            onChange={onUpload}
          />
          {uploadStatus && <p className="upload-status">{uploadStatus}</p>}
        </section>

        <section className="sidebar-card">
          <div className="section-heading">
            <span>Library</span>
            <span className="helper-chip">{documentsLoading ? "Syncing" : `${documents.length} docs`}</span>
          </div>
          <div className="mini-stat-grid">
            <div className="mini-stat">
              <span className="mini-stat-value">{documentStats.publicDocs}</span>
              <span className="mini-stat-label">public</span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">{documentStats.privateDocs}</span>
              <span className="mini-stat-label">private</span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">{documentStats.markdown}</span>
              <span className="mini-stat-label">markdown</span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">{documentStats.pdfs}</span>
              <span className="mini-stat-label">pdf</span>
            </div>
          </div>
          <div className="recent-list">
            {recentDocuments.length === 0 ? (
              <p className="empty-copy">No indexed documents yet.</p>
            ) : (
              recentDocuments.map((doc) => (
                <div key={doc.id} className="recent-item">
                  <div>
                    <p className="recent-item-title">{doc.filename}</p>
                    <p className="recent-item-meta">
                      {doc.file_type} · {doc.visibility}
                    </p>
                  </div>
                  <span className="recent-item-date">{formatDate(doc.created_at)}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </aside>

      <main className="workspace-main">
        <header className="workspace-header">
          <div className="header-copy">
            <p className="eyebrow">Chat</p>
            <h2>Ask questions against your indexed documents.</h2>
          </div>
          <div className="header-panel">
            <div className="header-panel-row">
              <span className="panel-label">Conversation</span>
              <span className="panel-value mono">
                {conversationId ? conversationId.slice(0, 8) : "New session"}
              </span>
            </div>
            <div className="header-panel-row">
              <span className="panel-label">Visibility</span>
              <span className="panel-value">{visibility}</span>
            </div>
            <div className="header-panel-row">
              <span className="panel-label">Sources</span>
              <span className="panel-value">Cited</span>
            </div>
          </div>
        </header>

        <section className="prompt-bar">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="prompt-chip"
              onClick={() => applyPrompt(prompt)}
            >
              {prompt}
            </button>
          ))}
        </section>

        <section className="chat-shell">
          <div ref={chatListRef} className="chat-list">
            {messages.length === 0 && !historyLoading && (
              <div className="welcome-panel">
                <div className="welcome-hero">
                  <h3>Start with a document, then ask a precise question.</h3>
                  <p className="empty-copy">Answers are generated only from indexed sources.</p>
                </div>
                <div className="welcome-grid">
                  <div className="welcome-card">
                    <strong>Upload</strong>
                    <p>Add markdown or PDF files.</p>
                  </div>
                  <div className="welcome-card">
                    <strong>Ask</strong>
                    <p>Query the indexed knowledge base.</p>
                  </div>
                  <div className="welcome-card">
                    <strong>Verify</strong>
                    <p>Open citations to inspect source files.</p>
                  </div>
                </div>
              </div>
            )}

            {messages.length === 0 && historyLoading && (
              <div className="empty-state">
                <p className="empty-title">Loading conversation...</p>
                <p className="empty-copy">Restoring recent grounded answers and citations.</p>
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
                    <div className="message-header">
                      <span className="message-label">{isUser ? "You" : "RKive"}</span>
                      <span className="message-subtitle">
                        {isUser ? "Question submitted" : "Grounded response"}
                      </span>
                    </div>
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
                      <div className="citation-block">
                        <div className="citation-block-header">
                          <span>Sources</span>
                          <span>{citations.length} attached</span>
                        </div>
                        <div className="citation-row">
                          {citations.map((citation, index) => (
                            <a
                              key={`${citation.documentId}-${index}`}
                              href={`${apiBase()}/api/documents/${citation.documentId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="citation-pill"
                            >
                              <span className="citation-index">[{index + 1}]</span>
                              <span className="citation-name">{formatCitationName(citation)}</span>
                              <span className="citation-score">
                                {formatCitationScore(citation.score)}
                              </span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void sendChat();
            }}
          >
            <div className="composer-frame">
              <textarea
                value={input}
                disabled={!connected || busy}
                placeholder={
                  connected
                    ? "Ask a grounded question about the indexed knowledge base..."
                    : "Connecting to RKive..."
                }
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onComposerKeyDown}
                className="composer-input composer-textarea"
                rows={3}
              />
              <div className="composer-meta">
                <span>Enter to send</span>
                <span>Shift + Enter for a new line</span>
              </div>
            </div>
            <button
              type="submit"
              className="composer-button"
              disabled={!connected || busy || !input.trim()}
            >
              {busy ? "Thinking..." : "Send question"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
