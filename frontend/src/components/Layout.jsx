import React, { useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Radio, ClipboardList, Users,
  BarChart3, MessageSquare, Cpu, Mic, Sun, Moon, BookOpen,
} from 'lucide-react';
import { AppContext } from '../App.jsx';

const NAV = [
  { id: 'dashboard',     Icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'live-meetings', Icon: Radio,            label: 'Live Meetings' },
  { id: 'history',       Icon: ClipboardList,    label: 'History' },
  { id: 'speakers',      Icon: Users,            label: 'Speakers' },
  { id: 'analytics',     Icon: BarChart3,        label: 'Analytics' },
  { id: 'chat',          Icon: MessageSquare,    label: 'Chat / RAG' },
  { id: 'handbook',      Icon: BookOpen,         label: 'Handbook' },
];

export default function Layout({ page, navigate, children }) {
  const { health, activeMeetingId, theme, toggleTheme } = useContext(AppContext);

  const statusClass = health.status === 'ok' ? 'ok'
    : health.status === 'initialising' ? 'warn' : 'error';
  const statusText = health.status === 'ok' ? 'All systems online'
    : health.status === 'initialising' ? 'Initialising…' : 'Service error';

  const whisperOk = health.models_loaded === true;
  const ollamaOk  = health.ollama_ready  === true;

  return (
    <>
      {/* ── Animated Background ──────────────────────────────────────────── */}
      <div className="neural-bg" />
      <div className="grid-lines" />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="brand" onClick={() => navigate('dashboard')}>
          <motion.div
            className="brand-logo"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            MoM
          </motion.div>
          <div className="brand-text">
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
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>

          <AnimatePresence>
            {activeMeetingId && (
              <motion.div
                className="live-badge"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={() => navigate('active-meeting', activeMeetingId)}
                style={{ cursor: 'pointer' }}
              >
                <div className="live-badge-dot" />
                LIVE
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <nav className="sidebar">
        <div className="nav-section">
          <div className="nav-section-label">Navigation</div>
          {NAV.map((item, i) => (
            <motion.div
              key={item.id}
              className={`nav-item ${page === item.id || (page === 'active-meeting' && item.id === 'live-meetings') ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
              whileHover={{ x: 3 }}
            >
              <span className="nav-icon">
                <item.Icon size={16} strokeWidth={2} />
              </span>
              <span>{item.label}</span>
              {item.id === 'live-meetings' && activeMeetingId && (
                <div className="nav-live-dot" />
              )}
            </motion.div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="model-status">
            <ModelRow icon={<Mic size={12} />} label="STT / Whisper" state={whisperOk} />
            <ModelRow icon={<Cpu size={12} />} label="LLM / Ollama"  state={ollamaOk} />
          </div>
        </div>
      </nav>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main className="main">
        {children}
      </main>
    </>
  );
}

function ModelRow({ icon, label, state }) {
  const cls = state === true ? 'ok' : state === false ? 'fail' : 'spin';
  const txt = state === true ? 'ready' : state === false ? 'off' : '…';
  return (
    <div className="model-row">
      <div className={`model-dot ${cls}`} />
      {icon}
      <span>{label}</span>
      <span>{txt}</span>
    </div>
  );
}
