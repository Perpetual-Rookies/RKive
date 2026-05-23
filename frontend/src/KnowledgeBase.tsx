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
    ? "Access to org-wide and sales content."
    : "Access to org-wide public content only.";
}

function roleScope(role: AppRole): string {
  return role === "Sales Representative"
    ? "Org knowledge + sales sources"
    : "Org-level public sources only";
}

export default function KnowledgeBase({
  role,
  visibility,
  documents,
  documentsLoading,
  documentStats,
  recentDocuments,
  onBack,
  onOpenFiles,
  onRoleChange,
  onVisibilityChange,
}: KnowledgeBaseProps) {
  return (
    <div className="settings-shell">
      <header className="page-toolbar">
        <PageBrand />
        <div className="page-toolbar-actions">
          <button type="button" className="icon-button" onClick={onBack} aria-label="Back to chat">
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

      <div className="settings-intro" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
        <p style={{ margin: 0, color: "var(--muted)" }}>Manage access and sources for RKive. Use the Documents library to upload and manage files — uploads are indexed for fast, grounded answers.</p>
        <div>
          <button type="button" className="topbar-cta topbar-cta--primary" onClick={onOpenFiles}>Open Documents</button>
        </div>
      </div>

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
          <span className="field-label">Role</span>
          <div className="visibility-toggle-group">
            {ROLE_OPTIONS.map((option) => {
              const isSelected = role === option;
              const isSalesRep = option === "Sales Representative";
              const label = isSalesRep ? "Sales Rep" : "Employee";
              return (
                <button
                  key={option}
                  type="button"
                  className={`toggle-button ${isSelected ? "is-selected" : ""} ${isSalesRep ? "is-private" : "is-public"}`}
                  onClick={() => onRoleChange(option)}
                >
                  {isSalesRep ? (
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
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
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
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                  )}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
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
                  onClick={() => onVisibilityChange(option)}
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
          <p className="section-copy">Uploads and full document management live in the Documents library. Click "Documents" to open the library and manage sources.</p>
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
                sales
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
                        {doc.file_type} · {doc.visibility === "Sales Project (Private)" ? "Sales" : "Public"}
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
