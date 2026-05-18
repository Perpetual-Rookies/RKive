import { useEffect, useMemo, useState, useCallback } from "react";
import type { ChangeEvent } from "react";
import rsystemsLogo from "./assets/rsystems-logo-white.svg";

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

  const onDelete = async (docId: string) => {
    if (!confirm("Delete this document and its vectors from the knowledge base?")) {
      return;
    }

    setDeleting(docId);
    try {
      const res = await fetch(`${apiBase()}/api/documents/${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error("Failed to delete document");
      }
      setDocuments((prev) => prev.filter((doc) => doc.id !== docId));
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

  return (
    <div className="library-shell">
      <aside className="library-sidebar">
        <div className="brand-block">
          <div className="brand-mark brand-logo">
            <img src={rsystemsLogo} alt="Rsystems" />
          </div>
          <div>
            <h1 className="brand-title">Documents</h1>
            <p className="brand-copy">Manage indexed sources</p>
          </div>
        </div>

        <section className="sidebar-card">
          <div className="section-heading">
            <span>Library metrics</span>
            <span className="helper-chip">{loading ? "Syncing" : "Current"}</span>
          </div>
          <div className="mini-stat-grid">
            <div className="mini-stat">
              <span className="mini-stat-value">{documents.length}</span>
              <span className="mini-stat-label">total</span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">{stats.publicDocs}</span>
              <span className="mini-stat-label">public</span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">{stats.privateDocs}</span>
              <span className="mini-stat-label">private</span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">{stats.pdfs}</span>
              <span className="mini-stat-label">pdf</span>
            </div>
          </div>
        </section>

        <section className="sidebar-card">
          <div className="section-heading">
            <span>Upload source</span>
            {onBack && (
              <button className="link-button" onClick={onBack} type="button">
                Chat
              </button>
            )}
          </div>
          <label className="field-label" htmlFor="library-visibility">
            Visibility
          </label>
          <select
            id="library-visibility"
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
          <label className="upload-button" htmlFor="library-upload">
            {uploading ? "Uploading..." : "Choose document"}
          </label>
          <input
            id="library-upload"
            type="file"
            accept=".md,.pdf,text/markdown,application/pdf"
            className="file-input"
            onChange={onUpload}
            disabled={uploading}
          />
          {uploadStatus && <p className="upload-status">{uploadStatus}</p>}
        </section>

      </aside>

      <main className="library-main">
        <header className="library-header">
          <div>
            <p className="eyebrow">Documents</p>
            <h2>Manage the sources that power RKive.</h2>
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
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="composer-input toolbar-search"
            placeholder="Filter by filename, type, or visibility"
          />
          <div className="filter-row">
            {(["All", ...VISIBILITY_OPTIONS] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`filter-chip ${activeVisibility === option ? "is-active" : ""}`}
                onClick={() => setActiveVisibility(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </section>

        {loading ? (
          <div className="empty-state">
            <p className="empty-title">Loading library...</p>
            <p className="empty-copy">Fetching indexed documents and visibility metadata.</p>
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">No documents match this view.</p>
            <p className="empty-copy">
              Adjust the filters or upload a new source to expand the knowledge base.
            </p>
          </div>
        ) : (
          <section className="document-grid">
            {filteredDocuments.map((doc) => (
              <article key={doc.id} className="document-card">
                <div className="document-card-top">
                  <div>
                    <span className="doc-type-badge">{doc.file_type}</span>
                    <h3>{doc.filename}</h3>
                  </div>
                  <span className="doc-visibility">{doc.visibility}</span>
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
                    onClick={() => onDelete(doc.id)}
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
  );
}
