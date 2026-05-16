import React, { useState, useEffect, useCallback } from 'react';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import LiveMeetings from './pages/LiveMeetings.jsx';
import ActiveMeeting from './pages/ActiveMeeting.jsx';
import MeetingHistory from './pages/MeetingHistory.jsx';
import MeetingDetail from './pages/MeetingDetail.jsx';
import Speakers from './pages/Speakers.jsx';
import { api } from './api.js';

export const ToastContext = React.createContext(null);
export const AppContext   = React.createContext(null);

let _toastId = 0;

export default function App() {
  const [page, setPage]         = useState('dashboard');
  const [pageParam, setPageParam] = useState(null);  // e.g. meeting id
  const [toasts, setToasts]     = useState([]);
  const [health, setHealth]     = useState({ status: 'checking', models: {} });
  const [activeMeetingId, setActiveMeetingId] = useState(null);

  /* ── Toast helpers ──────────────────────────────────────────────────────── */
  const toast = useCallback((msg, type = 'info', ttl = 4000) => {
    const id = ++_toastId;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ttl);
  }, []);

  /* ── Health polling ─────────────────────────────────────────────────────── */
  useEffect(() => {
    async function poll() {
      try {
        const d = await api.get('/health');
        setHealth(d);
      } catch {
        setHealth({ status: 'error', models: {} });
      }
    }
    poll();
    const iv = setInterval(poll, 15000);
    return () => clearInterval(iv);
  }, []);

  /* ── Navigation helper ──────────────────────────────────────────────────── */
  const navigate = useCallback((pg, param = null) => {
    setPage(pg);
    setPageParam(param);
  }, []);

  const appCtx = { health, activeMeetingId, setActiveMeetingId, navigate };

  /* ── Page renderer ──────────────────────────────────────────────────────── */
  function renderPage() {
    switch (page) {
      case 'dashboard':      return <Dashboard />;
      case 'live-meetings':  return <LiveMeetings />;
      case 'active-meeting': return <ActiveMeeting meetingId={pageParam} />;
      case 'history':        return <MeetingHistory />;
      case 'meeting-detail': return <MeetingDetail meetingId={pageParam} />;
      case 'speakers':       return <Speakers />;
      default:               return <Dashboard />;
    }
  }

  return (
    <ToastContext.Provider value={toast}>
      <AppContext.Provider value={appCtx}>
        <Layout page={page} navigate={navigate}>
          {renderPage()}
        </Layout>

        {/* Toast stack */}
        <div className="toast-wrap">
          {toasts.map(t => (
            <div key={t.id} className={`toast ${t.type}`}>
              <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : t.type === 'warn' ? '⚠' : 'ℹ'}</span>
              {t.msg}
            </div>
          ))}
        </div>
      </AppContext.Provider>
    </ToastContext.Provider>
  );
}
