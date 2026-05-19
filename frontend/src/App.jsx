import React, { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import LiveMeetings from './pages/LiveMeetings.jsx';
import ActiveMeeting from './pages/ActiveMeeting.jsx';
import MeetingHistory from './pages/MeetingHistory.jsx';
import MeetingDetail from './pages/MeetingDetail.jsx';
import Speakers from './pages/Speakers.jsx';
import Analytics from './pages/Analytics.jsx';
import Chat from './pages/Chat.jsx';
import HandbookChat from './pages/HandbookChat.jsx';
import { api } from './api.js';
import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react';

export const ToastContext = React.createContext(null);
export const AppContext   = React.createContext(null);

let _toastId = 0;

const pageVariants = {
  initial:  { opacity: 0, y: 14, scale: 0.99 },
  animate:  { opacity: 1, y: 0,  scale: 1 },
  exit:     { opacity: 0, y: -8, scale: 0.99 },
};
const pageTransition = { duration: 0.28, ease: [0.4, 0, 0.2, 1] };

export default function App() {
  const [page, setPage]           = useState('dashboard');
  const [pageParam, setPageParam] = useState(null);
  const [toasts, setToasts]       = useState([]);
  const [health, setHealth]       = useState({ status: 'checking', models: {} });
  const [activeMeetingId, setActiveMeetingId] = useState(null);
  const [theme, setTheme]         = useState(() => {
    const saved = localStorage.getItem('mom-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mom-theme', theme);
  }, [theme]);

  const navigate = useCallback((pg, param = null) => {
    setPage(pg);
    setPageParam(param);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const appCtx = { health, activeMeetingId, setActiveMeetingId, navigate, theme, toggleTheme };

  function renderPage() {
    switch (page) {
      case 'dashboard':      return <Dashboard key="dashboard" />;
      case 'live-meetings':  return <LiveMeetings key="live" />;
      case 'history':        return <MeetingHistory key="history" />;
      case 'meeting-detail': return <MeetingDetail key={`detail-${pageParam}`} meetingId={pageParam} />;
      case 'speakers':       return <Speakers key="speakers" />;
      case 'analytics':      return <Analytics key="analytics" />;
      case 'chat':           return <Chat key="chat" />;
      case 'handbook':       return <HandbookChat key="handbook" />;
      default:               return <Dashboard key="dashboard" />;
    }
  }

  const ToastIcon = ({ type }) => {
    if (type === 'success') return <CheckCircle size={13} />;
    if (type === 'error')   return <XCircle size={13} />;
    if (type === 'warn')    return <AlertTriangle size={13} />;
    return <Info size={13} />;
  };

  return (
    <ToastContext.Provider value={toast}>
      <AppContext.Provider value={appCtx}>
        <Layout page={page} navigate={navigate}>

          {/* ActiveMeeting stays mounted while active to preserve WebSocket + audio */}
          {activeMeetingId && (
            <div style={{ display: page === 'active-meeting' ? 'block' : 'none' }}>
              <ActiveMeeting meetingId={activeMeetingId} />
            </div>
          )}

          <AnimatePresence mode="wait">
            {page !== 'active-meeting' && (
              <motion.div
                key={page + (pageParam || '')}
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={pageTransition}
              >
                {renderPage()}
              </motion.div>
            )}
          </AnimatePresence>

          {page === 'active-meeting' && !activeMeetingId && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="empty-state" style={{ paddingTop: 80 }}
            >
              <div className="empty-state-title">No active meeting</div>
              <button className="btn btn-primary" onClick={() => navigate('dashboard')}>
                Go to Dashboard
              </button>
            </motion.div>
          )}
        </Layout>

        {/* ── Toasts ────────────────────────────────────────────────── */}
        <div className="toast-wrap">
          <AnimatePresence>
            {toasts.map(t => (
              <motion.div
                key={t.id}
                className={`toast ${t.type}`}
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0,  scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.22 }}
              >
                <span className="toast-icon"><ToastIcon type={t.type} /></span>
                {t.msg}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </AppContext.Provider>
    </ToastContext.Provider>
  );
}


