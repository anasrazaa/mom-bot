import React, { useContext, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Mic, ClipboardList, Users, BarChart3, MessageSquare,
  Radio, FileText, Calendar, ChevronRight, Sparkles,
} from 'lucide-react';
import { AppContext, ToastContext } from '../App.jsx';
import { api } from '../api.js';

const cardVar = {
  hidden:  { opacity: 0, y: 18 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.07, duration: 0.35, ease: [0.4, 0, 0.2, 1] } }),
};

export default function Dashboard() {
  const { navigate, activeMeetingId, setActiveMeetingId } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm]         = useState({ title: '', venue: '', chaired_by: '' });
  const [agendaText, setAgendaText] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.get('/meeting/history')
      .catch(() => ({ meetings: [] }))
      .then(r => { setMeetings(r.meetings || []); setLoading(false); });
  }, []);

  async function startMeeting(e) {
    e.preventDefault();
    if (!form.title.trim()) { toast('Meeting title is required', 'warn'); return; }
    setCreating(true);
    try {
      const agenda = agendaText.split('\n').map(l => l.trim()).filter(Boolean);
      const mtg = await api.post('/meeting/start', {
        title: form.title,
        venue: form.venue || 'Conference Room',
        chaired_by: form.chaired_by || null,
        agenda,
      });
      setActiveMeetingId(mtg.meeting_id);
      toast(`Meeting "${mtg.title}" started`, 'success');
      navigate('active-meeting', mtg.meeting_id);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setCreating(false);
    }
  }

  const recent = meetings.slice(0, 5);
  const totalMeetings = meetings.length;
  const completedMeetings = meetings.filter(m => m.status === 'completed').length;

  if (loading) return (
    <div className="loading-page">
      <div className="spinner" />
      <span>Loading dashboard…</span>
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">GIK Faculty Meeting Intelligence System</div>
        </div>
      </div>

      {/* ── Stats Row ────────────────────────────────────────────────────── */}
      <div className="stat-grid">
        {[
          { label: 'Total Meetings', value: totalMeetings, sub: 'all time' },
          { label: 'Completed',      value: completedMeetings, sub: 'with MoM' },
          { label: 'Active Now',     value: activeMeetingId ? 1 : 0, sub: activeMeetingId ? 'recording' : 'none' },
        ].map((s, i) => (
          <motion.div key={s.label} className="stat-card" custom={i} initial="hidden" animate="visible" variants={cardVar}>
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-sub">{s.sub}</div>
          </motion.div>
        ))}
      </div>

      {/* ── Active meeting banner ─────────────────────────────────────────── */}
      {activeMeetingId && (
        <motion.div className="active-banner" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="active-banner-left">
            <div className="active-banner-pulse" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#fca5a5' }}>Meeting in progress</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 1 }}>
                A recording is active. Only one meeting can run at a time.
              </div>
            </div>
          </div>
          <button className="btn btn-danger btn-sm" onClick={() => navigate('active-meeting', activeMeetingId)}>
            <Radio size={13} /> Return to Meeting
          </button>
        </motion.div>
      )}

      <div className="dash-grid">
        {/* ── New Meeting Form ────────────────────────────────────────────── */}
        <motion.div className="glass-card glow-blue" custom={3} initial="hidden" animate="visible" variants={cardVar}>
          <div className="card-header">
            <div className="card-header-left">
              <div className="card-header-icon"><Mic size={14} /></div>
              Start New Meeting
            </div>
            <span className="badge">AI-Powered</span>
          </div>
          <div className="card-body">
            {activeMeetingId ? (
              <div className="empty-state" style={{ padding: '32px 0' }}>
                <div className="empty-state-icon"><Radio size={24} /></div>
                <div className="empty-state-title">Meeting in progress</div>
                <div className="empty-state-desc">Stop the current meeting before starting a new one.</div>
              </div>
            ) : (
              <form onSubmit={startMeeting}>
                <div className="form-group">
                  <label className="form-label">Title <span className="req">*</span></label>
                  <input className="form-control" placeholder="e.g. Faculty Board Meeting – May 2025"
                    value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Venue</label>
                    <input className="form-control" placeholder="Conference Room, Admin Block"
                      value={form.venue} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Chaired By</label>
                    <input className="form-control" placeholder="e.g. Dr. Ahmed Khan"
                      value={form.chaired_by} onChange={e => setForm(f => ({ ...f, chaired_by: e.target.value }))} />
                  </div>
                </div>

                <div className="agenda-box">
                  <div className="agenda-box-header">
                    <label className="form-label" style={{ margin: 0 }}>
                      Agenda <span className="muted" style={{ fontWeight: 400, fontSize: 12, textTransform: 'none', letterSpacing: 0 }}>— one item per line</span>
                    </label>
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => fileInputRef.current?.click()}>
                      Upload .txt
                    </button>
                    <input ref={fileInputRef} type="file" accept=".txt,text/plain" style={{ display: 'none' }}
                      onChange={e => {
                        const f = e.target.files?.[0]; if (!f) return;
                        const reader = new FileReader();
                        reader.onload = ev => setAgendaText(ev.target.result || '');
                        reader.readAsText(f); e.target.value = '';
                      }} />
                  </div>
                  <textarea className="form-control" rows={4}
                    placeholder={"1. Budget Review\n2. New Course Approvals\n3. Faculty Promotions\n4. Any Other Business"}
                    value={agendaText} onChange={e => setAgendaText(e.target.value)} />
                  <div className="form-hint">The AI will structure the MoM around these items and search relevant past records.</div>
                </div>

                <div className="form-actions">
                  <motion.button
                    className="btn btn-ai btn-lg btn-full"
                    disabled={creating}
                    whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                  >
                    <Sparkles size={16} />
                    {creating ? 'Starting…' : 'Start Meeting'}
                  </motion.button>
                </div>
              </form>
            )}
          </div>
        </motion.div>

        {/* ── Right Column ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Recent Meetings */}
          <motion.div className="glass-card" custom={4} initial="hidden" animate="visible" variants={cardVar}>
            <div className="card-header">
              <div className="card-header-left">
                <div className="card-header-icon"><ClipboardList size={14} /></div>
                Recent Meetings
              </div>
              <button className="btn btn-ghost btn-xs" onClick={() => navigate('history')}>
                View all <ChevronRight size={12} />
              </button>
            </div>
            {recent.length === 0 ? (
              <div className="empty-state" style={{ padding: '28px 0' }}>
                <div className="empty-state-title">No meetings yet</div>
                <div className="empty-state-desc">Start your first meeting above.</div>
              </div>
            ) : (
              recent.map(m => (
                <div key={m.meeting_id} className="recent-item" onClick={() => navigate('meeting-detail', m.meeting_id)}>
                  <div>
                    <div className="recent-item-title">{m.title}</div>
                    <div className="recent-item-date">{fmtDate(m.start_time)}</div>
                  </div>
                  <div className="recent-item-right">
                    <StatusChip status={m.status} />
                    <ChevronRight size={14} style={{ color: 'var(--text-3)' }} />
                  </div>
                </div>
              ))
            )}
          </motion.div>

          {/* Quick Actions */}
          <motion.div className="glass-card" custom={5} initial="hidden" animate="visible" variants={cardVar}>
            <div className="card-header">
              <div className="card-header-left">
                <div className="card-header-icon" style={{ background: 'var(--purple-dim)', color: 'var(--purple)' }}>
                  <Sparkles size={14} />
                </div>
                Quick Actions
              </div>
            </div>
            <div className="quick-actions">
              {[
                { icon: ClipboardList, label: 'View All Meetings',  page: 'history' },
                { icon: Users,         label: 'Manage Speakers',    page: 'speakers' },
                { icon: BarChart3,     label: 'View Analytics',     page: 'analytics' },
                { icon: MessageSquare, label: 'Chat with History',  page: 'chat' },
              ].map(({ icon: Icon, label, page }) => (
                <button key={page} className="quick-btn" onClick={() => navigate(page)}>
                  <div className="quick-btn-icon"><Icon size={15} /></div>
                  {label}
                  <ChevronRight size={13} style={{ marginLeft: 'auto', opacity: 0.4 }} />
                </button>
              ))}
            </div>
          </motion.div>

        </div>
      </div>
    </>
  );
}

function StatusChip({ status }) {
  const map = { recording: 'chip-recording', stopped: 'chip-stopped', processing: 'chip-processing', completed: 'chip-completed' };
  return <span className={`chip ${map[status] || ''}`}>{status}</span>;
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
