import React, { useContext, useEffect, useState } from 'react';
import { AppContext, ToastContext } from '../App.jsx';
import { api } from '../api.js';

export default function Dashboard() {
  const { navigate, setActiveMeetingId } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meetings, setMeetings] = useState([]);
  const [speakers, setSpeakers] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm]         = useState({ title: '', venue: '', chaired_by: '' });

  useEffect(() => {
    Promise.all([
      api.get('/meeting/history').catch(() => ({ meetings: [] })),
      api.get('/speaker/').catch(() => ({ speakers: [] })),
    ]).then(([mResp, sResp]) => {
      setMeetings(mResp.meetings || []);
      setSpeakers(sResp.speakers || []);
      setLoading(false);
    });
  }, []);

  async function startMeeting(e) {
    e.preventDefault();
    if (!form.title.trim()) { toast('Meeting title is required', 'warn'); return; }
    setCreating(true);
    try {
      const mtg = await api.post('/meeting/start', {
        title: form.title,
        venue: form.venue || 'Conference Room',
        chaired_by: form.chaired_by || null,
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
  const done   = meetings.filter(m => m.status === 'completed').length;
  const recs   = meetings.filter(m => m.status === 'recording').length;

  if (loading) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="page-hdr">
        <div>
          <h1>Dashboard</h1>
          <p>Overview of your meeting intelligence system</p>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard val={meetings.length} lbl="Total Meetings" />
        <StatCard val={done}            lbl="Completed" />
        <StatCard val={recs}            lbl="Recording" />
        <StatCard val={speakers.length} lbl="Registered Speakers" />
      </div>

      <div className="dash-grid">
        <div className="card">
          <div className="card-hdr">🎙 Start New Meeting</div>
          <form className="form-card" onSubmit={startMeeting}>
            <div className="form-group">
              <label className="form-label">Title <span className="req">*</span></label>
              <input className="form-input" placeholder="e.g. Faculty Board Meeting – May 2025"
                value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Venue</label>
                <input className="form-input" placeholder="Conference Room, Admin Block"
                  value={form.venue} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Chaired By</label>
                <input className="form-input" placeholder="e.g. Dr. Ahmed Khan"
                  value={form.chaired_by} onChange={e => setForm(f => ({ ...f, chaired_by: e.target.value }))} />
              </div>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary btn-lg" disabled={creating}>
                {creating ? 'Starting…' : '▶ Start Recording'}
              </button>
            </div>
          </form>
        </div>

        <div>
          <div className="card">
            <div className="card-hdr">
              Recent Meetings
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('history')}>View all →</button>
            </div>
            {recent.length === 0 ? (
              <div className="empty">No meetings yet</div>
            ) : (
              recent.map(m => (
                <div key={m.meeting_id} className="mini-meeting">
                  <div>
                    <div className="mini-mtg-title">{m.title}</div>
                    <div className="mini-mtg-date">{fmtDate(m.start_time)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusChip status={m.status} />
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => navigate('meeting-detail', m.meeting_id)}>Open</button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="card">
            <div className="card-hdr">Quick Actions</div>
            <div className="quick-stack">
              <button className="btn btn-outline btn-w" onClick={() => navigate('history')}>📋 View All Meetings</button>
              <button className="btn btn-outline btn-w" onClick={() => navigate('speakers')}>👥 Manage Speakers</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function StatCard({ val, lbl }) {
  return <div className="stat-card"><div className="stat-val">{val}</div><div className="stat-lbl">{lbl}</div></div>;
}

function StatusChip({ status }) {
  const map = { recording: 'chip-recording', stopped: 'chip-stopped', processing: 'chip-processing', completed: 'chip-completed' };
  return <span className={`chip ${map[status] || ''}`}>{status}</span>;
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
