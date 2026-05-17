import React, { useState, useEffect, useCallback } from 'react';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import LiveMeetings from './pages/LiveMeetings.jsx';
import ActiveMeeting from './pages/ActiveMeeting.jsx';
import MeetingHistory from './pages/MeetingHistory.jsx';
import MeetingDetail from './pages/MeetingDetail.jsx';
import Speakers from './pages/Speakers.jsx';
import Analytics from './pages/Analytics.jsx';
import Chat from './pages/Chat.jsx';
import { api } from './api.js';

export const ToastContext = React.createContext(null);
export const AppContext   = React.createContext(null);

let _toastId = 0;

export default function App() {
  const [page, setPage]           = useState('dashboard');
  const [pageParam, setPageParam] = useState(null);
  const [toasts, setToasts]       = useState([]);
  const [health, setHealth]       = useState({ status: 'checking', models: {} });
  const [activeMeetingId, setActiveMeetingId] = useState(null);

  const toast = useCallback((msg, type = 'info', ttl = 4000) => {
    const id = ++_toastId;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ttl);
  }, []);

  useEffect(() => {
    async function poll() {
      try { setHealth(await api.get('/health')); }
      catch { setHealth({ status: 'error', models: {} }); }
    }
    poll();
    const iv = setInterval(poll, 15000);
    return () => clearInterval(iv);
  }, []);

  const navigate = useCallback((pg, param = null) => {
    setPage(pg);
    setPageParam(param);
  }, []);

  const appCtx = { health, activeMeetingId, setActiveMeetingId, navigate };

  function renderPage() {
    switch (page) {
      case 'dashboard':      return <Dashboard />;
      case 'live-meetings':  return <LiveMeetings />;
      case 'history':        return <MeetingHistory />;
      case 'meeting-detail': return <MeetingDetail meetingId={pageParam} />;
      case 'speakers':       return <Speakers />;
      case 'analytics':      return <Analytics />;
      case 'chat':           return <Chat />;
      default:               return <Dashboard />;
    }
  }

  return (
    <ToastContext.Provider value={toast}>
      <AppContext.Provider value={appCtx}>
        <Layout page={page} navigate={navigate}>

          {/*
            ActiveMeeting is ALWAYS mounted when activeMeetingId is set so the
            mic, timer, and WebSocket connections survive navigation between pages.
            We just toggle visibility with CSS — the component never unmounts.
          */}
          {activeMeetingId && (
            <div style={{ display: page === 'active-meeting' ? 'block' : 'none' }}>
              <ActiveMeeting meetingId={activeMeetingId} />
            </div>
          )}

          {/* All other pages render normally; active-meeting is handled above */}
          {page !== 'active-meeting' && renderPage()}

          {/* Safety fallback: navigated to active-meeting but no meeting in state */}
          {page === 'active-meeting' && !activeMeetingId && (
            <div className="empty" style={{ paddingTop: 80 }}>
              No active meeting. <button className="btn btn-primary" style={{ marginLeft: 12 }}
                onClick={() => navigate('dashboard')}>Go to Dashboard</button>
            </div>
          )}

        </Layout>

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
