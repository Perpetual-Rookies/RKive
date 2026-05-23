import { useEffect, useMemo, useState, useCallback } from "react";
import type { ChangeEvent } from "react";
import PageBrand from "./PageBrand";
import ConfirmModal from "./ConfirmModal";

type FileType = "Markdown" | "PDF";
type Visibility = "Org Level (Public)" | "Sales Project (Private)";

type DocumentInfo = {
  id: string;
  filename: string;
  created_at: string | null;
  file_type: FileType;
  visibility: string;
};

type FilesProps = {
  onBack?: () => void;
};

const VISIBILITY_OPTIONS: Visibility[] = [
  "Org Level (Public)",
  "Sales Project (Private)",
];

function apiBase(): string {
  return import.meta.env.VITE_API_BASE ?? "";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Unknown";
  return new Date(dateStr).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Files({ onBack }: FilesProps) {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Visibility>(VISIBILITY_OPTIONS[0]);
  const [search, setSearch] = useState("");
  const [activeVisibility, setActiveVisibility] = useState<"All" | Visibility>("All");

  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiBase()}/api/documents`);
      if (!res.ok) {
        throw new Error("Failed to load documents");
      }
      const data = (await res.json()) as { documents?: DocumentInfo[] };
      setDocuments(data.documents ?? []);
    } catch (err) {
      console.error(err);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const name = file.name.toLowerCase();
    if (!name.endsWith(".md") && !name.endsWith(".pdf")) {
      setUploadStatus("Please choose a .md or .pdf file.");
      return;
    }

    setUploading(true);
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
        setUploadStatus(
          typeof data.error === "string"
            ? data.error
            : typeof data.detail === "string"
              ? data.detail
              : `HTTP ${res.status}`,
        );
        return;
      }

      const chunks = typeof data.chunks === "number" ? data.chunks : "?";
      setUploadStatus(`Indexed ${chunks} chunks successfully.`);
      await loadDocuments();
    } catch (err) {
      setUploadStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDoc, setConfirmDoc] = useState<DocumentInfo | null>(null);

  const onDelete = (doc: DocumentInfo) => {
    setConfirmDoc(doc);
    setConfirmOpen(true);
  };

  const performDelete = async () => {
    if (!confirmDoc) return;
    const docId = confirmDoc.id;
    setDeleting(docId);
    try {
      const res = await fetch(`${apiBase()}/api/documents/${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error("Failed to delete document");
      }
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      setConfirmOpen(false);
      setConfirmDoc(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete document");
    } finally {
      setDeleting(null);
    }
  };

  const filteredDocuments = useMemo(() => {
    const term = search.trim().toLowerCase();
    return documents.filter((doc) => {
      const matchesVisibility =
        activeVisibility === "All" ? true : doc.visibility === activeVisibility;
      const matchesSearch =
        term.length === 0 ||
        doc.filename.toLowerCase().includes(term) ||
        doc.file_type.toLowerCase().includes(term) ||
        doc.visibility.toLowerCase().includes(term);
      return matchesVisibility && matchesSearch;
    });
  }, [activeVisibility, documents, search]);

  const stats = useMemo(() => {
    const publicDocs = documents.filter((doc) => doc.visibility === VISIBILITY_OPTIONS[0]).length;
    const privateDocs = documents.filter((doc) => doc.visibility === VISIBILITY_OPTIONS[1]).length;
    const pdfs = documents.filter((doc) => doc.file_type === "PDF").length;
    const markdown = documents.length - pdfs;
    return { publicDocs, privateDocs, pdfs, markdown };
  }, [documents]);

  const filterCounts = useMemo(() => {
    const all = documents.length;
    const publicDocs = documents.filter((doc) => doc.visibility === VISIBILITY_OPTIONS[0]).length;
    const privateDocs = documents.filter((doc) => doc.visibility === VISIBILITY_OPTIONS[1]).length;
    return {
      All: all,
      [VISIBILITY_OPTIONS[0]]: publicDocs,
      [VISIBILITY_OPTIONS[1]]: privateDocs,
    };
  }, [documents]);

  return (
    <div className="files-page">
      <header className="page-toolbar">
        <PageBrand />
        <div className="page-toolbar-actions">
          {onBack && (
            <button className="icon-button" onClick={onBack} type="button" aria-label="Back to knowledge base">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="icon-button-glyph"
                aria-hidden="true"
              >
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
              <span>Knowledge base</span>
            </button>
          )}
        </div>
      </header>

      <div className="library-shell">
      <aside className="library-sidebar">
        <section className="sidebar-card">
          <div className="section-heading">
            <span className="section-title-group">
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
                className="section-title-icon"
              >
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
              </svg>
              Library metrics
            </span>
            <span className="helper-chip">{loading ? "Syncing" : "Current"}</span>
          </div>
          <div className="mini-stat-grid">
            <div className="mini-stat">
              <span className="mini-stat-value">{documents.length}</span>
              <span className="mini-stat-label">
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
                  className="mini-stat-icon"
                >
                  <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                  <polyline points="2 17 12 22 22 17"></polyline>
                  <polyline points="2 12 12 17 22 12"></polyline>
                </svg>
                total
              </span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">{stats.publicDocs}</span>
              <span className="mini-stat-label">
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
                  className="mini-stat-icon"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
                public
              </span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">{stats.privateDocs}</span>
              <span className="mini-stat-label">
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
                  className="mini-stat-icon"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
                sales
              </span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">{stats.pdfs}</span>
              <span className="mini-stat-label">
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
                  className="mini-stat-icon"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                pdf
              </span>
            </div>
          </div>
        </section>

        <section className="sidebar-card">
          <div className="section-heading">
            <span className="section-title-group">
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
                className="section-title-icon"
              >
                <path d="M21.2 15a8.2 8.2 0 0 0-15.6-3A5.4 5.4 0 0 0 6 22h13a5.3 5.3 0 0 0 2.2-7z"></path>
                <polyline points="16 16 12 12 8 16"></polyline>
                <line x1="12" y1="12" x2="12" y2="21"></line>
              </svg>
              Upload source
            </span>
          </div>
          <span className="field-label">Visibility</span>
          <div className="visibility-toggle-group">
            {VISIBILITY_OPTIONS.map((option) => {
              const isSelected = visibility === option;
              const isPrivate = option === "Sales Project (Private)";
              const label = isPrivate ? "Sales" : "Public";
              return (
                <button
                  key={option}
                  type="button"
                  className={`toggle-button ${isSelected ? "is-selected" : ""} ${isPrivate ? "is-private" : "is-public"}`}
                  onClick={() => setVisibility(option)}
                >
                  {isPrivate ? (
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
                      className="toggle-button-icon"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                  ) : (
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
                      className="toggle-button-icon"
                    >
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="2" y1="12" x2="22" y2="12"></line>
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                    </svg>
                  )}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
          <label className="upload-button" htmlFor="library-upload">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="upload-btn-icon"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <span>{uploading ? "Uploading..." : "Choose document"}</span>
          </label>
          <input
            id="library-upload"
            type="file"
            accept=".md,.pdf,text/markdown,application/pdf"
            className="file-input"
            onChange={onUpload}
            disabled={uploading}
          />
          {uploadStatus && (
            <p className={`upload-status ${
              uploadStatus.includes("successfully") || uploadStatus.includes("Indexed")
                ? "is-success"
                : uploadStatus.includes("Uploading") || uploadStatus.includes("indexing")
                  ? "is-loading"
                  : "is-error"
            }`}>
              {uploadStatus}
            </p>
          )}
        </section>

      </aside>

      <main className="library-main">
        <header className="library-header">
          <div>
            <p className="eyebrow">Documents</p>
            <h2 className="subheader-title">
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
                className="subheader-icon"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              Manage the sources that power RKive.
            </h2>
          </div>
          <div className="header-panel">
            <div className="header-panel-row">
              <span className="panel-label">Markdown</span>
              <span className="panel-value">{stats.markdown}</span>
            </div>
            <div className="header-panel-row">
              <span className="panel-label">PDF</span>
              <span className="panel-value">{stats.pdfs}</span>
            </div>
            <div className="header-panel-row">
              <span className="panel-label">Visible now</span>
              <span className="panel-value">{filteredDocuments.length}</span>
            </div>
          </div>
        </header>

        <section className="library-toolbar">
          <div className="search-wrapper">
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
              className="search-icon"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="composer-input toolbar-search"
              placeholder="Filter by filename, type, or visibility..."
            />
          </div>
          <div className="filter-row">
            {(["All", ...VISIBILITY_OPTIONS] as const).map((option) => {
              const label =
                option === "All"
                  ? "All sources"
                  : option === "Org Level (Public)"
                    ? "Public"
                    : "Sales";
              return (
                <button
                  key={option}
                  type="button"
                  className={`filter-chip ${activeVisibility === option ? "is-active" : ""}`}
                  onClick={() => setActiveVisibility(option)}
                >
                  <span>{label}</span>
                  <span className="filter-chip-count">{filterCounts[option]}</span>
                </button>
              );
            })}
          </div>
        </section>

        {loading ? (
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
              Loading library...
            </p>
            <p className="empty-copy">Fetching indexed documents and visibility metadata.</p>
          </div>
        ) : filteredDocuments.length === 0 ? (
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
                className="empty-state-icon"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              No documents match this view.
            </p>
            <p className="empty-copy">
              Adjust the filters or upload a new source to expand the knowledge base.
            </p>
          </div>
        ) : (
          <section className="document-grid">
            {filteredDocuments.map((doc) => (
              <article key={doc.id} className="document-card">
                <div className="document-card-body">
                  <div className="document-card-info">
                    <div className="recent-item-icon">
                      {doc.file_type === "PDF" ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="recent-icon pdf-color"
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="recent-icon md-color"
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                          <line x1="16" y1="13" x2="8" y2="13"></line>
                          <line x1="16" y1="17" x2="8" y2="17"></line>
                          <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                      )}
                    </div>
                    <div className="document-card-title-group">
                      <h3 className="document-filename" title={doc.filename}>{doc.filename}</h3>
                    </div>
                  </div>
                  <div className="document-card-badges">
                    <span className="doc-type-badge">{doc.file_type}</span>
                    <span className={`visibility-badge ${doc.visibility === "Sales Project (Private)" ? "is-private" : "is-public"}`}>
                      {doc.visibility === "Sales Project (Private)" ? (
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
                          className="badge-icon"
                          aria-hidden="true"
                        >
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                      ) : (
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
                          className="badge-icon"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="2" y1="12" x2="22" y2="12"></line>
                          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                        </svg>
                      )}
                      <span>{doc.visibility === "Sales Project (Private)" ? "Sales" : "Public"}</span>
                    </span>
                  </div>
                </div>
                <div className="document-card-meta">
                  <span>Indexed {formatDate(doc.created_at)}</span>
                  <span className="mono">{doc.id.slice(0, 8)}</span>
                </div>
                <div className="document-card-actions">
                  <a
                    href={`${apiBase()}/api/documents/${doc.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="secondary-button"
                  >
                    Open
                  </a>
                  <button
                    className="danger-button"
                    onClick={() => onDelete(doc)}
                    disabled={deleting === doc.id}
                    type="button"
                  >
                    {deleting === doc.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Delete document?"
        description={confirmDoc ? `Delete "${confirmDoc.filename}" and its vectors from the knowledge base? This action cannot be undone.` : undefined}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loading={!!(confirmDoc && deleting === confirmDoc.id)}
        onCancel={() => { setConfirmOpen(false); setConfirmDoc(null); }}
        onConfirm={performDelete}
      />

    </div>
  );
}
