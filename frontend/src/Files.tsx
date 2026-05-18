import { useEffect, useState, useCallback, ChangeEvent } from "react";
import type { ReactNode } from "react";
import rsystemsLogo from "./assets/rsystems-logo-white.svg";

type FileType = "Markdown" | "PDF";

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

type Visibility = "Org Level (Public)" | "Sales Project (Private)";

const VISIBILITY_OPTIONS: Visibility[] = [
  "Org Level (Public)",
  "Sales Project (Private)",
];

function apiBase(): string {
  return import.meta.env.VITE_API_BASE ?? "";
}

export default function Files({ onBack }: FilesProps) {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Visibility>(
    VISIBILITY_OPTIONS[0]
  );

  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiBase()}/api/documents`);
      if (!res.ok) {
        throw new Error("Failed to load documents");
      }
      const data = (await res.json()) as { documents: DocumentInfo[] };
      setDocuments(data.documents);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const name = file.name.toLowerCase();
    if (!name.endsWith(".md") && !name.endsWith(".pdf")) {
      setUploadStatus("Please choose a .md or .pdf file");
      return;
    }

    setUploading(true);
    setUploadStatus("Uploading...");

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
          typeof data.error === "string" ? data.error : `HTTP ${res.status}`
        );
        return;
      }
      setUploadStatus("Upload successful!");
      setTimeout(() => setUploadStatus(null), 3000);
      await loadDocuments();
    } catch (err) {
      setUploadStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (docId: string) => {
    if (!confirm("Are you sure you want to delete this document?")) {
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
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to delete document");
    } finally {
      setDeleting(null);
    }
  };

  const groupByVisibility = (): Array<{
    visibility: string;
    markdown: DocumentInfo[];
    pdf: DocumentInfo[];
  }> => {
    const groups = new Map<string, { markdown: DocumentInfo[]; pdf: DocumentInfo[] }>();
    documents.forEach((doc) => {
      const key = doc.visibility || VISIBILITY_OPTIONS[0];
      const group = groups.get(key) ?? { markdown: [], pdf: [] };
      if (doc.file_type === "PDF") {
        group.pdf.push(doc);
      } else {
        group.markdown.push(doc);
      }
      groups.set(key, group);
    });

    const known = VISIBILITY_OPTIONS.map((visibility) => ({
      visibility,
      ...((groups.get(visibility) ?? { markdown: [], pdf: [] }) as {
        markdown: DocumentInfo[];
        pdf: DocumentInfo[];
      }),
    }));

    const extras = Array.from(groups.entries())
      .filter(([visibility]) => !VISIBILITY_OPTIONS.includes(visibility as Visibility))
      .map(([visibility, group]) => ({ visibility, ...group }));

    return [...known, ...extras].filter(
      (group) => group.markdown.length + group.pdf.length > 0
    );
  };

  const visibilityGroups = groupByVisibility();

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "Unknown";
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const renderDocumentRow = (doc: DocumentInfo): ReactNode => (
    <div key={doc.id} className="document-row">
      <div className="document-info">
        <div className="document-name">{doc.filename}</div>
        <div className="document-meta">
          <span className="file-type-badge">{doc.file_type}</span>
          <span className="upload-date">{formatDate(doc.created_at)}</span>
        </div>
      </div>
      <button
        className="delete-button"
        onClick={() => onDelete(doc.id)}
        disabled={deleting === doc.id}
      >
        {deleting === doc.id ? "Deleting..." : "Delete"}
      </button>
    </div>
  );

  const renderCategory = (title: string, docs: DocumentInfo[]): ReactNode => {
    if (docs.length === 0) return null;

    return (
      <section key={title} className="document-category">
        <h2 className="category-heading">{title}</h2>
        <div className="document-list">{docs.map(renderDocumentRow)}</div>
      </section>
    );
  };

  return (
    <div className="files-page">
      <aside className="files-sidebar">
        <div className="brand-block">
          <div className="brand-mark brand-logo">
            <img src={rsystemsLogo} alt="Rsystems" />
          </div>
          <div>
            <h1 className="brand-title">RKive</h1>
            <p className="brand-copy">Document management</p>
          </div>
        </div>

        <section className="files-sidebar-section">
          <div className="files-section-heading">
            <span>Upload documents</span>
          </div>
          <p className="files-section-copy">
            Upload markdown or PDF documents to your knowledge base.
          </p>

          <label className="field-label" htmlFor="files-visibility">
            Visibility
          </label>
          <select
            id="files-visibility"
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

          <label className="files-upload-label" htmlFor="file-upload">
            Choose document
          </label>
          <input
            id="file-upload"
            type="file"
            accept=".md,.pdf,text/markdown,application/pdf"
            className="file-input"
            onChange={onUpload}
            disabled={uploading}
          />
          {uploadStatus && (
            <div
              className={`files-upload-status ${
                uploadStatus.includes("successful") ? "success" : "error"
              }`}
            >
              {uploadStatus}
            </div>
          )}
        </section>
      </aside>

      <main className="files-main">
        <div className="files-topbar">
          {onBack && (
            <button className="back-button" onClick={onBack} type="button">
              Back to chat
            </button>
          )}
          <div className="files-topbar-meta">Knowledge base</div>
        </div>
        <header className="files-header">
          <h1>Your Documents</h1>
          <p className="header-subtitle">
            {documents.length} total document{documents.length !== 1 ? "s" : ""}
          </p>
        </header>

        {loading ? (
          <div className="loading">Loading documents...</div>
        ) : documents.length === 0 ? (
          <div className="empty-state">
            <p>No documents yet. Upload one to get started!</p>
          </div>
        ) : (
          <div className="documents-container">
            {visibilityGroups.map((group) => (
              <section key={group.visibility} className="visibility-group">
                <div className="visibility-header">
                  <h2 className="visibility-title">{group.visibility}</h2>
                  <span className="visibility-count">
                    {group.markdown.length + group.pdf.length} docs
                  </span>
                </div>
                <div className="visibility-body">
                  {renderCategory("Markdown", group.markdown)}
                  {renderCategory("PDF", group.pdf)}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
