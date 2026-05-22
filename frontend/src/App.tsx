import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";
import Files from "./Files";
import KnowledgeBase from "./KnowledgeBase";
import PageBrand from "./PageBrand";
import SessionPanel from "./SessionPanel";
import Toast from "./Toast";

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

function formatCitationName(citation: Citation): string {
  const candidate =
    citation.filename?.trim() || citation.sourcePath?.trim() || citation.documentId;
  const pieces = candidate.split(/[\\/]/);
  return pieces[pieces.length - 1] || candidate || citation.documentId;
}

function formatCitationScore(score: number): string {
  if (!Number.isFinite(score)) return "0%";
  return `${Math.max(0, Math.min(100, Math.round(score * 100)))}% match`;
}

function renderTextWithCitations(text: string, citations: Citation[]): ReactNode[] {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, index) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const citationIdx = parseInt(match[1], 10) - 1;
      const citation = citations[citationIdx];
      if (citation) {
        const name = formatCitationName(citation);
        const score = formatCitationScore(citation.score);
        return (
          <span key={`cite-${index}`} className="citation-tooltip-wrapper">
            <a
              href={`${apiBase()}/api/documents/${citation.documentId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-citation"
            >
              [{citationIdx + 1}]
            </a>
            <span className="citation-tooltip">
              <span className="tooltip-name">{name}</span>
              <span className="tooltip-score">{score}</span>
            </span>
          </span>
        );
      }
    }
    return part;
  });
}

function renderInlineMarkdown(text: string, citations: Citation[]): ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*)/g);

  return parts.flatMap((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={index}>
          {renderTextWithCitations(part.slice(2, -2), citations)}
        </strong>
      );
    }
    return renderTextWithCitations(part, citations);
  });
}

function renderAssistantContent(content: string, citations: Citation[]): ReactNode {
  const lines = content.split("\n").map((line) => line.trimEnd());
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    nodes.push(
      <ul key={`list-${nodes.length}`} className="message-list">
        {listItems.map((item, index) => (
          <li key={index}>{renderInlineMarkdown(item, citations)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();

    // Check for H3
    const h3Match = trimmed.match(/^###\s+(.*)$/);
    if (h3Match) {
      flushList();
      nodes.push(
        <h4 key={`h3-${nodes.length}`} className="message-h3">
          {renderInlineMarkdown(h3Match[1], citations)}
        </h4>,
      );
      return;
    }

    // Check for H2
    const h2Match = trimmed.match(/^##\s+(.*)$/);
    if (h2Match) {
      flushList();
      nodes.push(
        <h3 key={`h2-${nodes.length}`} className="message-h2">
          {renderInlineMarkdown(h2Match[1], citations)}
        </h3>,
      );
      return;
    }

    // Check for H1
    const h1Match = trimmed.match(/^#\s+(.*)$/);
    if (h1Match) {
      flushList();
      nodes.push(
        <h2 key={`h1-${nodes.length}`} className="message-h1">
          {renderInlineMarkdown(h1Match[1], citations)}
        </h2>,
      );
      return;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      listItems.push(bulletMatch[1]);
      return;
    }

    flushList();

    if (!trimmed) return;

    nodes.push(
      <p key={`p-${nodes.length}`} className="message-paragraph">
        {renderInlineMarkdown(trimmed, citations)}
      </p>,
    );
  });

  flushList();

  return nodes.length === 0 ? content : nodes;
}

export default function App() {
  const [page, setPage] = useState<"chat" | "knowledge" | "files">("chat");
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
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const connected = true;

  useEffect(() => {
    if (role === "Standard Employee") {
      setVisibility("Org Level (Public)");
    } else if (role === "Sales Representative") {
      setVisibility("Sales Project (Private)");
    }
  }, [role]);

  const showToast = useCallback((message: string) => {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(message);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, 3000);
  }, []);

  const startNewConversation = useCallback(() => {
    if (busy) return;
    assistantIdRef.current = null;
    setConversationId(null);
    setMessages([]);
    setInput("");
    setHistoryLoading(false);
  }, [busy]);

  const shareConversation = useCallback(async () => {
    if (!conversationId) {
      showToast("Send a message first to create a shareable conversation.");
      return;
    }

    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Conversation link copied.");
    } catch {
      showToast("Could not copy the conversation link.");
    }
  }, [conversationId, showToast]);

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
          messages?: Array<{
            role: Role;
            content: string;
            citations?: Array<{
              documentId?: string;
              document_id?: string;
              sourcePath?: string;
              source_path?: string;
              score?: number;
              filename?: string;
            }>;
          }>;
        };
        if (!active) return;
        setMessages(
          (data.messages ?? []).map((msg) => {
            const rawCitations = Array.isArray(msg.citations) ? msg.citations : [];
            const citations = rawCitations
              .map((c) => {
                const docId = c.documentId || c.document_id || "";
                const srcPath = c.sourcePath || c.source_path || "";
                const score = typeof c.score === "number" ? c.score : 0;
                const filename = c.filename || "";
                if (!docId && !srcPath) return null;
                return {
                  documentId: docId,
                  sourcePath: srcPath,
                  score,
                  filename,
                } satisfies Citation;
              })
              .filter((c): c is Citation => c !== null);

            return {
              id: crypto.randomUUID(),
              role: msg.role,
              content: msg.content,
              streaming: false,
              citations: citations.length > 0 ? citations : undefined,
            };
          }),
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

  useEffect(() => {
    if (page !== "chat" || historyLoading || messages.length === 0) return;
    composerRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [historyLoading, messages.length, page]);

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
        prev.map((message) => {
          if (message.id === aid) {
            const updated = { ...message, citations };
            if (typeof msg.content === "string") {
              updated.content = msg.content;
            }
            return updated;
          }
          return message;
        }),
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
        <Files onBack={() => setPage("knowledge")} />
      </div>
    );
  }

  if (page === "knowledge") {
    return (
      <div className="app-wrapper">
        <KnowledgeBase
          role={role}
          visibility={visibility}
          uploadStatus={uploadStatus}
          documents={documents}
          documentsLoading={documentsLoading}
          documentStats={documentStats}
          recentDocuments={recentDocuments}
          onBack={() => setPage("chat")}
          onOpenFiles={() => setPage("files")}
          onRoleChange={setRole}
          onVisibilityChange={setVisibility}
          onUpload={onUpload}
        />
      </div>
    );
  }

  return (
    <div className="chat-app">
      <header className="page-toolbar">
        <PageBrand />
        <div className="page-toolbar-actions">
          <button
            type="button"
            className="topbar-cta topbar-cta--primary"
            onClick={() => setPage("knowledge")}
            aria-label="Open knowledge base"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="topbar-cta__icon"
              aria-hidden="true"
            >
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
            </svg>
            <span className="topbar-cta__label">Knowledge base</span>
          </button>
        </div>
      </header>

      <div className="chat-workspace">
        <SessionPanel
          connected={connected}
          role={role}
          visibility={visibility}
          messageCount={messages.length}
          hasConversation={conversationId !== null}
          busy={busy}
          onNewConversation={startNewConversation}
          onShare={() => void shareConversation()}
          onRoleChange={setRole}
        />

        <main className="chat-main">
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
                  <h3 className="welcome-hero-title">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="welcome-hero-icon"
                      aria-hidden="true"
                    >
                      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                      <path d="m5 3 1 2.5L8.5 6 6 7 5 9.5 4 7 1.5 6 4 5 5 3Z" />
                      <path d="m19 17 1 2.5 2.5.5-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z" />
                    </svg>
                    <span className="welcome-hero-text">Ask a question about your indexed knowledge.</span>
                  </h3>
                  <p className="empty-copy">
                    Upload sources and adjust access from the knowledge base when you need them.
                  </p>
                </div>
                <div className="welcome-grid">
                  <div className="welcome-card">
                    <div className="welcome-card-icon">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="welcome-icon"
                        aria-hidden="true"
                      >
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                      </svg>
                    </div>
                    <strong>Knowledge base</strong>
                    <p>Upload markdown or PDF sources and manage access.</p>
                  </div>
                  <div className="welcome-card">
                    <div className="welcome-card-icon">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="welcome-icon"
                        aria-hidden="true"
                      >
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                      </svg>
                    </div>
                    <strong>Ask</strong>
                    <p>Query the indexed knowledge base.</p>
                  </div>
                  <div className="welcome-card">
                    <div className="welcome-card-icon">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="welcome-icon"
                        aria-hidden="true"
                      >
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                      </svg>
                    </div>
                    <strong>Verify</strong>
                    <p>Open citations to inspect the original source.</p>
                  </div>
                </div>
              </div>
            )}

            {messages.length === 0 && historyLoading && (
              <div className="empty-state">
                <p className="empty-title">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="loading-spinner-icon"
                    aria-hidden="true"
                  >
                    <line x1="12" y1="2" x2="12" y2="6"></line>
                    <line x1="12" y1="18" x2="12" y2="22"></line>
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                    <line x1="2" y1="12" x2="6" y2="12"></line>
                    <line x1="18" y1="12" x2="22" y2="12"></line>
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                  </svg>
                  <span>Loading conversation...</span>
                </p>
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
                      <span className="message-label">{isUser ? "You" : "RKive answer"}</span>
                      <span className="message-subtitle">
                        {isUser ? "Question submitted" : "Grounded response"}
                      </span>
                    </div>
                    <div className="message-content">
                      {isAssistant ? renderAssistantContent(message.content, citations) : message.content}
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
                          <span className="citation-header-label">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="citation-header-icon"
                              aria-hidden="true"
                            >
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                            </svg>
                            Sources
                          </span>
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
            ref={composerRef}
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
              <div className="composer-footer">
                <span className="composer-hint composer-hint--left">Enter to send</span>
                <button
                  type="submit"
                  className="composer-button"
                  disabled={!connected || busy || !input.trim()}
                >
                  {busy ? "Thinking..." : "Send"}
                </button>
                <span className="composer-hint composer-hint--right">
                  Shift + Enter for a new line
                </span>
              </div>
            </div>
          </form>
        </section>
        </main>
      </div>

      <Toast message={toastMessage} />
    </div>
  );
}
