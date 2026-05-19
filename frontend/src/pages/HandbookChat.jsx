import React, { useContext, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Send, Loader2, BookMarked, Radio } from 'lucide-react';
import { AppContext, ToastContext } from '../App.jsx';
import { api } from '../api.js';

export default function HandbookChat() {
  const { activeMeetingId, navigate } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [status, setStatus]     = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    api.get('/handbook/status')
      .then(s => setStatus(s))
      .catch(() => setStatus({ indexed: false, chunks: 0 }));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(e) {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    setInput('');

    const userMsg = { role: 'user', content: q };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const history = messages.slice(-6);
      const res = await api.post('/handbook/chat', { question: q, history });
      setMessages(prev => [...prev, { role: 'assistant', content: res.answer, sources: res.sources }]);
    } catch (err) {
      toast(err.message, 'error');
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, an error occurred. Please try again.', sources: [] }]);
    } finally {
      setLoading(false);
    }
  }

  const SUGGESTED = [
    'What are the promotion criteria for faculty?',
    'What is the leave policy for faculty members?',
    'How is faculty performance evaluated?',
    'What are the rules for academic integrity?',
    'What benefits are available to faculty?',
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Faculty Handbook Assistant</div>
          <div className="page-sub">
            Ask anything about GIK faculty policies, rules, and regulations
            {status && (
              <span style={{ marginLeft: 10 }} className={`badge ${status.indexed ? 'badge-green' : 'badge-warn'}`}>
                {status.indexed ? `${status.chunks} sections indexed` : 'Not indexed'}
              </span>
            )}
          </div>
        </div>
        {activeMeetingId && (
          <div className="page-actions">
            <button className="btn btn-danger btn-sm" onClick={() => navigate('active-meeting', activeMeetingId)}>
              <Radio size={13} /> Live Meeting
            </button>
          </div>
        )}
      </div>

      <div className="chat-layout">
        {/* ── Message area ─────────────────────────────────────────────────── */}
        <motion.div
          className="glass-card chat-messages-card"
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        >
          <div className="chat-messages">
            {messages.length === 0 && !loading && (
              <div className="chat-empty">
                <div className="chat-empty-icon"><BookOpen size={32} color="var(--purple)" /></div>
                <div className="chat-empty-title">Faculty Handbook Assistant</div>
                <div className="chat-empty-desc">
                  Ask about faculty policies, leave rules, promotion criteria, academic regulations, and more.
                </div>
                <div className="chat-suggestions">
                  {SUGGESTED.map((s, i) => (
                    <button key={i} className="chat-suggestion-chip" onClick={() => { setInput(s); }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <AnimatePresence initial={false}>
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  className={`chat-msg ${m.role}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22 }}
                >
                  {m.role === 'assistant' && (
                    <div className="chat-msg-avatar">
                      <BookMarked size={13} />
                    </div>
                  )}
                  <div className="chat-msg-bubble">
                    <div className="chat-msg-text" style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                    {m.sources?.length > 0 && (
                      <div className="chat-sources">
                        <div className="chat-sources-label">Sources</div>
                        {m.sources.map((s, si) => (
                          <div key={si} className="chat-source-item">
                            <span className="chat-source-tag">Page {s.page}</span>
                            <span className="chat-source-text">{s.text.slice(0, 120)}…</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {loading && (
              <motion.div className="chat-msg assistant" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="chat-msg-avatar"><BookMarked size={13} /></div>
                <div className="chat-msg-bubble chat-typing">
                  <Loader2 size={14} className="spin" />
                  <span>Looking up handbook…</span>
                </div>
              </motion.div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* ── Input ───────────────────────────────────────────────────── */}
          <form className="chat-input-row" onSubmit={send}>
            <input
              className="chat-input"
              placeholder="Ask about faculty policies, leave, promotion, regulations…"
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={loading || (status && !status.indexed)}
            />
            <button
              className="btn btn-ai btn-sm"
              type="submit"
              disabled={loading || !input.trim() || (status && !status.indexed)}
            >
              {loading ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
            </button>
          </form>

          {status && !status.indexed && (
            <div className="chat-notice">
              Handbook is not indexed yet. Please restart the server to trigger indexing.
            </div>
          )}
        </motion.div>
      </div>
    </>
  );
}
