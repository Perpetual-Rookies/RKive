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
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          </svg>
          Sources and access
        </h2>
      </header>

      <div className="settings-content">
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
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
              Access
            </span>
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
              Add source
            </span>
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
            <span>Upload knowledge document</span>
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
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              Recent sources
            </span>
            <span className="helper-chip">
              {documentsLoading ? "Syncing" : `${documents.length} docs`}
            </span>
          </div>
          <div className="mini-stat-grid">
            <div className="mini-stat">
              <span className="mini-stat-value">{documentStats.publicDocs}</span>
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
              <span className="mini-stat-value">{documentStats.privateDocs}</span>
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
                private
              </span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">{documentStats.markdown}</span>
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
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                markdown
              </span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">{documentStats.pdfs}</span>
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
          <div className="recent-list">
            {recentDocuments.length === 0 ? (
              <p className="empty-copy">No indexed documents yet.</p>
            ) : (
              recentDocuments.map((doc) => (
                <div key={doc.id} className="recent-item">
                  <div className="recent-item-main">
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
                    <div className="recent-item-info">
                      <p className="recent-item-title">{doc.filename}</p>
                      <p className="recent-item-meta">
                        {doc.file_type} · {doc.visibility}
                      </p>
                    </div>
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
