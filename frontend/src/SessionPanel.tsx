type AppRole = "Standard Employee" | "Sales Representative";
type Visibility = "Org Level (Public)" | "Sales Project (Private)";

type SessionPanelProps = {
  connected: boolean;
  role: AppRole;
  visibility: Visibility;
  messageCount: number;
  hasConversation: boolean;
  busy: boolean;
  onNewConversation: () => void;
  onShare: () => void;
};

function roleScope(role: AppRole): string {
  return role === "Sales Representative"
    ? "Org knowledge + sales-private sources"
    : "Org-level public sources only";
}

export default function SessionPanel({
  connected,
  role,
  visibility,
  messageCount,
  hasConversation,
  busy,
  onNewConversation,
  onShare,
}: SessionPanelProps) {
  return (
    <aside className="session-panel sidebar-card">
      <div className="section-heading">
        <span>Session</span>
        <span className="status-pill is-online">
          <span className="status-dot" />
          {connected ? "Connected" : "Offline"}
        </span>
      </div>

      <div className="header-panel-row">
        <span className="panel-label">Status</span>
        <span className="panel-value">
          {hasConversation ? "Active conversation" : "New conversation"}
        </span>
      </div>

      <div className="header-panel-row">
        <span className="panel-label">Role</span>
        <span className="panel-value">{role}</span>
      </div>

      <div className="header-panel-row">
        <span className="panel-label">Visibility</span>
        <span className="panel-value">{visibility}</span>
      </div>

      <div className="header-panel-row">
        <span className="panel-label">Grounding</span>
        <span className="panel-value">Cited</span>
      </div>

      <div className="header-panel-row">
        <span className="panel-label">Messages</span>
        <span className="panel-value">{messageCount}</span>
      </div>

      <div className="scope-banner">
        <span className="scope-label">Scope</span>
        <strong>{roleScope(role)}</strong>
      </div>

      <div className="session-actions">
        <button
          type="button"
          className="topbar-cta topbar-cta--primary"
          onClick={onNewConversation}
          disabled={busy}
        >
          <span className="topbar-cta__icon" aria-hidden="true">
            +
          </span>
          <span className="topbar-cta__label">New conversation</span>
        </button>
        <button
          type="button"
          className="topbar-cta topbar-cta--secondary"
          onClick={onShare}
          disabled={!hasConversation}
          aria-label="Copy conversation link"
        >
          <span className="topbar-cta__icon" aria-hidden="true">
            ⎘
          </span>
          <span className="topbar-cta__label">Share</span>
        </button>
      </div>
    </aside>
  );
}
