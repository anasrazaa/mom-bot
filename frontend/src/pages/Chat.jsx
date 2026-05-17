import React, { useContext, useEffect, useRef, useState } from 'react';
import { AppContext, ToastContext } from '../App.jsx';
import { api } from '../api.js';

export default function Chat() {
  const { navigate } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meetings, setMeetings]         = useState([]);
  const [filterId, setFilterId]         = useState('all');
  const [messages, setMessages]         = useState([]);
  const [input, setInput]               = useState('');
  const [sending, setSending]           = useState(false);
  const [tab, setTab]                   = useState('chat');   // 'chat' | 'prepare'
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
      const history = messages.slice(-6);  // last 3 turns
      const resp = await api.post('/chat/message', {
        question: q,
        history: history.length ? history : null,
        meeting_id: filterId === 'all' ? null : filterId,
      });
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: resp.answer, sources: resp.sources || [] },
      ]);
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

  function clearChat() {
    setMessages([]);
  }

  const indexedCount = indexedIds.length;
  const filteredMeetings = meetings.filter(m =>
    filterId === 'all' || m.meeting_id === filterId
  );

  return (
    <>
      <div className="page-hdr">
        <div>
          <h1>Meeting Intelligence Chat</h1>
          <p>Ask questions about your meeting history or get pre-meeting preparation briefs</p>
        </div>
        <div className="page-hdr-actions">
          <div className="chat-indexed-badge">
            <span className="badge" style={{ background: 'var(--c-primary)', color: '#fff' }}>{indexedCount}</span>
            <span className="muted" style={{ fontSize: 12 }}>meetings indexed</span>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="chat-tabs">
        <button
          className={`chat-tab${tab === 'chat' ? ' active' : ''}`}
          onClick={() => setTab('chat')}
        >
          💬 Chat with History
        </button>
        <button
          className={`chat-tab${tab === 'prepare' ? ' active' : ''}`}
          onClick={() => setTab('prepare')}
        >
          📋 Meeting Prep Brief
        </button>
      </div>

      {/* Meeting scope filter */}
      <div className="chat-filter-bar">
        <span className="muted" style={{ fontSize: 12 }}>Search scope:</span>
        <select
          className="chat-scope-select"
          value={filterId}
          onChange={e => setFilterId(e.target.value)}
        >
          <option value="all">All meetings</option>
          {meetings.map(m => (
            <option key={m.meeting_id} value={m.meeting_id}>
              {m.title} ({fmtDate(m.start_time)})
            </option>
          ))}
        </select>
        {indexedCount === 0 && (
          <span className="muted" style={{ fontSize: 11, color: 'var(--c-warn)' }}>
            ⚠ No meetings indexed yet — record a meeting first
          </span>
        )}
      </div>

      {tab === 'chat' ? (
        <div className="chat-layout">
          {/* Message list */}
          <div className="chat-messages">
            {messages.length === 0 ? (
              <div className="chat-empty">
                <div style={{ fontSize: 40 }}>💬</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginTop: 12 }}>Ask anything about your meetings</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>Examples:</div>
                <div className="chat-suggestions">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} className="chat-suggestion" onClick={() => setInput(s)}>{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
                  <div className="chat-msg-avatar">
                    {msg.role === 'user' ? '👤' : '🤖'}
                  </div>
                  <div className="chat-msg-body">
                    <div className="chat-msg-text">{msg.content}</div>
                    {msg.sources?.length > 0 && (
                      <div className="chat-sources">
                        <div className="chat-sources-label">Sources:</div>
                        {msg.sources.map((src, si) => (
                          <div key={si} className="chat-source-chip" title={src.text}>
                            📄 {src.meeting_title}
                            <span className="chat-source-score">{Math.round(src.score * 100)}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {sending && (
              <div className="chat-msg chat-msg-assistant">
                <div className="chat-msg-avatar">🤖</div>
                <div className="chat-msg-body">
                  <div className="ai-thinking">
                    <div className="ai-thinking-dots"><span /><span /><span /></div>
                    <span>Thinking…</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Input */}
          <form className="chat-input-bar" onSubmit={sendMessage}>
            {messages.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearChat} title="Clear conversation">
                ✕
              </button>
            )}
            <input
              className="chat-input"
              placeholder="Ask about meetings, decisions, action items…"
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={sending}
              autoFocus
            />
            <button className="btn btn-primary" type="submit" disabled={sending || !input.trim()}>
              {sending ? '…' : 'Send →'}
            </button>
          </form>
        </div>
      ) : (
        <div className="card prep-card">
          <div className="card-hdr">
            📋 Pre-Meeting Preparation Brief
          </div>
          <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--c-border)' }}>
            <label className="form-label">
              Agenda Items <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(one per line)</span>
            </label>
            <textarea
              className="form-input agenda-textarea"
              placeholder={"1. Budget Review\n2. New Course Approvals\n3. Faculty Promotions\n4. Any Other Business"}
              rows={5}
              value={agendaText}
              onChange={e => setAgendaText(e.target.value)}
            />
            <div className="form-hint" style={{ marginTop: 6 }}>
              The AI will search past meeting records for relevant background on each item.
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={getPrepBrief}
              disabled={briefLoading || !agendaText.trim()}
            >
              {briefLoading ? '⚙ Generating…' : '✦ Generate Prep Brief'}
            </button>
          </div>

          {brief && <BriefView brief={brief} />}
        </div>
      )}
    </>
  );
}

const SUGGESTIONS = [
  'What were the main decisions in the last meeting?',
  'What action items are assigned to faculty?',
  'Has the budget been discussed in any meetings?',
  'Who chaired the most recent meeting?',
];

function BriefView({ brief }) {
  if (!brief) return null;
  return (
    <div className="brief-content">
      {brief.items?.map((item, i) => (
        <div key={i} className="brief-item">
          <div className="brief-item-title">{i + 1}. {item.agenda_item}</div>
          {item.background && (
            <div className="brief-section">
              <div className="brief-section-lbl">Background</div>
              <div className="brief-section-body">{item.background}</div>
            </div>
          )}
          {item.open_actions?.length > 0 && (
            <div className="brief-section">
              <div className="brief-section-lbl">Open Actions</div>
              {item.open_actions.map((a, ai) => (
                <div key={ai} className="brief-bullet">• {a}</div>
              ))}
            </div>
          )}
          {item.watch_points?.length > 0 && (
            <div className="brief-section">
              <div className="brief-section-lbl">Watch Points</div>
              {item.watch_points.map((w, wi) => (
                <div key={wi} className="brief-bullet brief-warn">⚠ {w}</div>
              ))}
            </div>
          )}
        </div>
      ))}
      {brief.overall_notes && (
        <div className="brief-overall">
          <div className="brief-section-lbl">Overall Notes</div>
          <div className="brief-section-body">{brief.overall_notes}</div>
        </div>
      )}
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
