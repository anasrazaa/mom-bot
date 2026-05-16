import React, { useContext } from 'react';
import { AppContext } from '../App.jsx';

const NAV = [
  { id: 'dashboard',     icon: '⊞', label: 'Dashboard' },
  { id: 'live-meetings', icon: '🔴', label: 'Live Meetings' },
  { id: 'history',       icon: '📋', label: 'History' },
  { id: 'speakers',      icon: '👥', label: 'Speakers' },
];

export default function Layout({ page, navigate, children }) {
  const { health, activeMeetingId } = useContext(AppContext);

  const statusClass = health.status === 'ok' ? 'ok'
    : health.status === 'initialising' ? 'warn' : 'error';
  const statusText = health.status === 'ok' ? 'All systems online'
    : health.status === 'initialising' ? 'Initialising…' : 'Service error';

  const whisperOk  = health.models_loaded === true;
  const ollamaOk   = health.ollama_ready  === true;

  return (
    <>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="brand">
          <div className="brand-logo">MoM</div>
          <div>
            <div className="brand-name">GIK MoM Assistant</div>
            <div className="brand-sub">Faculty Meeting Intelligence</div>
          </div>
        </div>

        <div className="header-center">
          <div className="status-pill">
            <div className={`status-dot ${statusClass}`} />
            {statusText}
          </div>
        </div>

        <div className="header-right">
          {activeMeetingId && (
            <div className="rec-badge">
              <div className="status-dot warn" style={{ width: 8, height: 8 }} />
              LIVE
            </div>
          )}
        </div>
      </header>

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <nav className="sidebar">
        <div className="nav-section">
          <div className="nav-section-lbl">Navigation</div>
          {NAV.map(item => (
            <div
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === 'live-meetings' && activeMeetingId && (
                <div className="rec-indicator" style={{ marginLeft: 'auto' }} />
              )}
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="model-grid">
            <ModelRow label="STT/Whisper" state={whisperOk} />
            <ModelRow label="LLM/Ollama"  state={ollamaOk} />
          </div>
        </div>
      </nav>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main className="main">{children}</main>
    </>
  );
}

function ModelRow({ label, state }) {
  const cls = state === true ? 'ok' : state === false ? 'fail' : 'spin';
  const txt = state === true ? 'ready' : state === false ? 'off' : '…';
  return (
    <div className="model-row">
      <div className={`mdot ${cls}`} />
      <span>{label}</span>
      <span style={{ marginLeft: 'auto', fontSize: 11 }}>{txt}</span>
    </div>
  );
}
