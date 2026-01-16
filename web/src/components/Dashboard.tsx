import { useAuthActions } from "@convex-dev/auth/react";
import "./Dashboard.css";

export function Dashboard() {
  const { signOut } = useAuthActions();

  return (
    <div className="dashboard">
      <nav className="dashboard-nav">
        <div className="nav-logo">
          CEL<span className="accent">.</span>STATE
        </div>
        <div className="nav-right">
          <button className="signout-button" onClick={() => signOut()}>
            Sign Out
          </button>
        </div>
      </nav>

      <main className="dashboard-main">
        <div className="welcome-section">
          <div className="welcome-badge">
            <span className="badge-dot" />
            Authenticated
          </div>
          <h1 className="welcome-title">
            Your <em>workspace</em>
          </h1>
          <p className="welcome-subtitle">
            You're signed in. The dashboard is coming soon.
          </p>
        </div>

        <div className="placeholder-grid">
          <div className="placeholder-card">
            <div className="card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18" />
                <path d="M9 21V9" />
              </svg>
            </div>
            <h3>Asset Library</h3>
            <p>Browse and manage your transparent assets</p>
            <span className="coming-soon">Coming Soon</span>
          </div>

          <div className="placeholder-card">
            <div className="card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h3>Generate</h3>
            <p>Create new transparent images with AI</p>
            <span className="coming-soon">Coming Soon</span>
          </div>

          <div className="placeholder-card">
            <div className="card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <h3>API Access</h3>
            <p>Integrate Celstate into your workflow</p>
            <span className="coming-soon">Coming Soon</span>
          </div>
        </div>
      </main>

      <footer className="dashboard-footer">
        <span>© 2026 Celstate</span>
        <span className="footer-separator">·</span>
        <a href="/landing/">Landing Page</a>
      </footer>
    </div>
  );
}
