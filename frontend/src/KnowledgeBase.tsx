import type { ChangeEvent } from "react";
import PageBrand from "./PageBrand";

type AppRole = "Standard Employee" | "Sales Representative";
type Visibility = "Org Level (Public)" | "Sales Project (Private)";

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

type KnowledgeBaseProps = {
  role: AppRole;
  visibility: Visibility;
  uploadStatus: string | null;
  documents: DocumentInfo[];
  documentsLoading: boolean;
  documentStats: {
    publicDocs: number;
    privateDocs: number;
    pdfs: number;
    markdown: number;
  };
  recentDocuments: DocumentInfo[];
  onBack: () => void;
  onOpenFiles: () => void;
  onRoleChange: (role: AppRole) => void;
  onVisibilityChange: (visibility: Visibility) => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
};

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

export default function KnowledgeBase({
  role,
  visibility,
  uploadStatus,
  documents,
  documentsLoading,
  documentStats,
  recentDocuments,
  onBack,
  onOpenFiles,
  onRoleChange,
  onVisibilityChange,
  onUpload,
}: KnowledgeBaseProps) {
  return (
    <div className="settings-shell">
      <header className="page-toolbar">
        <PageBrand />
        <div className="page-toolbar-actions">
          <button type="button" className="icon-button" onClick={onBack} aria-label="Back to chat">
            <span className="icon-button-glyph" aria-hidden="true">
              ←
            </span>
            <span>Chat</span>
          </button>
        </div>
      </header>

      <header className="page-subheader">
        <p className="eyebrow">Knowledge base</p>
        <h2>Sources and access</h2>
      </header>

      <div className="settings-content">
        <section className="sidebar-card">
          <div className="section-heading">
            <span>Access</span>
          </div>
          <label className="field-label" htmlFor="kb-role-select">
            Role
          </label>
          <select
            id="kb-role-select"
            className="select"
            value={role}
            onChange={(event) => onRoleChange(event.target.value as AppRole)}
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
            <span>Add source</span>
            <button className="link-button" onClick={onOpenFiles} type="button">
              Documents
            </button>
          </div>
          <label className="field-label" htmlFor="kb-visibility-select">
            Visibility
          </label>
          <select
            id="kb-visibility-select"
            className="select"
            value={visibility}
            onChange={(event) => onVisibilityChange(event.target.value as Visibility)}
          >
            {VISIBILITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <label className="upload-button" htmlFor="kb-document-upload">
            Upload knowledge document
          </label>
          <input
            id="kb-document-upload"
            type="file"
            accept=".md,.pdf,text/markdown,application/pdf"
            className="file-input"
            onChange={onUpload}
          />
          {uploadStatus && <p className="upload-status">{uploadStatus}</p>}
        </section>

        <section className="sidebar-card">
          <div className="section-heading">
            <span>Recent sources</span>
            <span className="helper-chip">
              {documentsLoading ? "Syncing" : `${documents.length} docs`}
            </span>
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
      </div>
    </div>
  );
}
