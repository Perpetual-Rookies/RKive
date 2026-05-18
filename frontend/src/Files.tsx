import { useEffect, useState, useCallback, ChangeEvent } from "react";
import type { ReactNode } from "react";

type FileType = "Markdown" | "PDF";

type DocumentInfo = {
  id: string;
  filename: string;
  created_at: string | null;
  file_type: FileType;
};

function apiBase(): string {
  return import.meta.env.VITE_API_BASE ?? "";
}

export default function Files() {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

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
    setUploadStatus("Uploading…");

    const fd = new FormData();
    fd.append("file", file);
    fd.append("visibility", "Org Level (Public)");

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

  const groupByType = (): { markdown: DocumentInfo[]; pdf: DocumentInfo[] } => {
    const markdown: DocumentInfo[] = [];
    const pdf: DocumentInfo[] = [];

    documents.forEach((doc) => {
      if (doc.file_type === "PDF") {
        pdf.push(doc);
      } else {
        markdown.push(doc);
      }
    });

    return { markdown, pdf };
  };

  const { markdown, pdf } = groupByType();

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
        {deleting === doc.id ? "Deleting…" : "Delete"}
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
          <div className="brand-mark">RK</div>
          <div>
            <h1 className="brand-title">RKive</h1>
            <p className="brand-copy">Document Management</p>
          </div>
        </div>

        <section className="files-sidebar-section">
          <div className="files-section-heading">
            <span>Upload Documents</span>
          </div>
          <p className="files-section-copy">
            Upload markdown or PDF documents to your knowledge base.
          </p>

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
        <header className="files-header">
          <h1>Your Documents</h1>
          <p className="header-subtitle">
            {documents.length} total document{documents.length !== 1 ? "s" : ""}
          </p>
        </header>

        {loading ? (
          <div className="loading">Loading documents…</div>
        ) : documents.length === 0 ? (
          <div className="empty-state">
            <p>No documents yet. Upload one to get started!</p>
          </div>
        ) : (
          <div className="documents-container">
            {renderCategory("Markdown Documents", markdown)}
            {renderCategory("PDF Documents", pdf)}
          </div>
        )}
      </main>
    </div>
  );
}
