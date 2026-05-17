import React, { useContext, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, ClipboardList, Send, X, Sparkles, BookOpen, Bot, User } from 'lucide-react';
import { AppContext, ToastContext } from '../App.jsx';
import { api } from '../api.js';

const SUGGESTIONS = [
  'What were the main decisions in the last meeting?',
  'What action items are assigned to faculty?',
  'Has the budget been discussed in any meetings?',
  'Who chaired the most recent meeting?',
];

export default function Chat() {
  const { navigate } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meetings, setMeetings]         = useState([]);
  const [filterId, setFilterId]         = useState('all');
  const [messages, setMessages]         = useState([]);
  const [input, setInput]               = useState('');
  const [sending, setSending]           = useState(false);
  const [tab, setTab]                   = useState('chat');
  const [agendaText, setAgendaText]     = useState('');
  const [briefLoading, setBriefLoading] = useState(false);
  const [brief, setBrief]               = useState(null);
  const [indexedIds, setIndexedIds]     = useState([]);
  const endRef = useRef(null);

  useEffect(() => {
    Promise.all([
      api.get('/meeting/history').catch(() => ({ meetings: [] })),
      api.get('/chat/indexed').catch(() => ({ meeting_ids: [] })),
    ]).then(([h, idx]) => {
      setMeetings(h.meetings || []);
      setIndexedIds(idx.meeting_ids || []);
    });
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function sendMessage(e) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    const userMsg = { role: 'user', content: q };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);
    try {
      const history = messages.slice(-6);
      const resp = await api.post('/chat/message', {
        question: q,
        history: history.length ? history : null,
        meeting_id: filterId === 'all' ? null : filterId,
      });
      setMessages(prev => [...prev, { role: 'assistant', content: resp.answer, sources: resp.sources || [] }]);
    } catch (err) {
      toast(err.message, 'error');
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.', sources: [] }]);
    } finally {
      setSending(false);
    }
  }

  async function getPrepBrief() {
    const items = agendaText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!items.length) { toast('Enter agenda items first', 'warn'); return; }
    setBriefLoading(true);
    try {
      const result = await api.post('/chat/prepare', {
        agenda: items,
        meeting_id: filterId === 'all' ? null : filterId,
      });
      setBrief(result);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBriefLoading(false);
    }
  }

  const indexedCount = indexedIds.length;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Meeting Intelligence Chat</div>
          <div className="page-sub">Ask questions about meeting history or get pre-meeting preparation briefs</div>
        </div>
        <div className="page-actions">
          <div className="chat-indexed-badge">
            <span className="badge">{indexedCount}</span>
            <span className="muted" style={{ fontSize: 12 }}>meetings indexed</span>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="chat-tabs-row">
        <button className={`chat-tab${tab === 'chat' ? ' active' : ''}`} onClick={() => setTab('chat')}>
          <MessageSquare size={14} /> Chat with History
        </button>
        <button className={`chat-tab${tab === 'prepare' ? ' active' : ''}`} onClick={() => setTab('prepare')}>
          <ClipboardList size={14} /> Meeting Prep Brief
        </button>
      </div>

      {/* Scope filter */}
      <div className="chat-scope-bar">
        <label>Search scope:</label>
        <select value={filterId} onChange={e => setFilterId(e.target.value)}>
          <option value="all">All meetings</option>
          {meetings.map(m => (
            <option key={m.meeting_id} value={m.meeting_id}>
              {m.title} ({fmtDate(m.start_time)})
            </option>
          ))}
        </select>
        {indexedCount === 0 && (
          <span style={{ fontSize: 11, color: 'var(--amber)' }}>⚠ No meetings indexed yet</span>
        )}
      </div>

      {tab === 'chat' ? (
        <div className="chat-container">
          <div className="chat-messages-wrap">
            {messages.length === 0 ? (
              <div className="chat-empty-state">
                <div className="chat-empty-icon"><MessageSquare size={32} /></div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Ask anything about your meetings</div>
                <div className="text-3" style={{ fontSize: 13 }}>Try one of these:</div>
                <div className="chat-suggestions">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} className="chat-suggestion-btn" onClick={() => setInput(s)}>{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`chat-message ${msg.role}`}>
                  <div className={`chat-avatar ${msg.role === 'user' ? 'user-av' : 'ai-av'}`}>
                    {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                  </div>
                  <div>
                    <div className={`chat-bubble ${msg.role === 'user' ? 'user-bubble' : 'ai-bubble'}`}>
                      {msg.content}
                    </div>
                    {msg.sources?.length > 0 && (
                      <div className="chat-sources">
                        <div className="chat-source-label">Sources:</div>
                        {msg.sources.map((src, si) => (
                          <div key={si} className="chat-source-chip" title={src.text}>
                            📄 {src.meeting_title}
                            <span className="source-score">{Math.round(src.score * 100)}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {sending && (
              <div className="chat-message assistant">
                <div className="chat-avatar ai-av"><Bot size={16} /></div>
                <div className="chat-bubble ai-bubble">
                  <div className="typing-dots"><span /><span /><span /></div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="chat-input-area">
            {messages.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMessages([])} title="Clear">
                <X size={14} />
              </button>
            )}
            <textarea
              className="chat-input"
              rows={1}
              placeholder="Ask about meetings, decisions, action items…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e); } }}
              disabled={sending}
            />
            <motion.button
              className="btn btn-primary"
              type="button"
              disabled={sending || !input.trim()}
              onClick={sendMessage}
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}
            >
              {sending ? '…' : <Send size={15} />}
            </motion.button>
          </div>
        </div>
      ) : (
        <motion.div className="glass-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <div className="card-header">
            <div className="card-header-left">
              <div className="card-header-icon" style={{ background: 'var(--purple-dim)', color: 'var(--purple)' }}><BookOpen size={13} /></div>
              Pre-Meeting Preparation Brief
            </div>
          </div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Agenda Items <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— one per line</span></label>
              <textarea
                className="form-control"
                rows={5}
                placeholder={"1. Budget Review\n2. New Course Approvals\n3. Faculty Promotions"}
                value={agendaText}
                onChange={e => setAgendaText(e.target.value)}
              />
              <div className="form-hint">The AI will search past meeting records for relevant background on each item.</div>
            </div>
            <motion.button
              className="btn btn-ai"
              onClick={getPrepBrief}
              disabled={briefLoading || !agendaText.trim()}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            >
              <Sparkles size={14} /> {briefLoading ? 'Generating…' : 'Generate Prep Brief'}
            </motion.button>
          </div>
          {brief && <BriefView brief={brief} />}
        </motion.div>
      )}
    </>
  );
}

function BriefView({ brief }) {
  if (!brief) return null;
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      {brief.items?.map((item, i) => (
        <div key={i} style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: 'var(--text)' }}>{i + 1}. {item.agenda_item}</div>
          {item.background && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--blue)', marginBottom: 6 }}>Background</div>
              <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.7 }}>{item.background}</div>
            </div>
          )}
          {item.open_actions?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--green)', marginBottom: 6 }}>Open Actions</div>
              {item.open_actions.map((a, ai) => <div key={ai} style={{ fontSize: 13.5, color: 'var(--text)', marginBottom: 3 }}>• {a}</div>)}
            </div>
          )}
          {item.watch_points?.length > 0 && (
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--amber)', marginBottom: 6 }}>Watch Points</div>
              {item.watch_points.map((w, wi) => <div key={wi} style={{ fontSize: 13.5, color: 'var(--amber)', marginBottom: 3 }}>⚠ {w}</div>)}
            </div>
          )}
        </div>
      ))}
      {brief.overall_notes && (
        <div style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--purple)', marginBottom: 8 }}>Overall Notes</div>
          <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.7 }}>{brief.overall_notes}</div>
        </div>
      )}
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
