import React, { useContext, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ClipboardList, ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, Radio } from 'lucide-react';
import { AppContext, ToastContext } from '../App.jsx';
import { api } from '../api.js';

export default function MeetingHistory() {
  const { navigate, activeMeetingId } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [sort, setSort]         = useState({ key: 'date', dir: 'desc' });

  useEffect(() => {
    api.get('/meeting/history')
      .then(r => { setMeetings(r.meetings || []); setLoading(false); })
      .catch(() => { toast('Failed to load meetings', 'error'); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleSort(key) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  }

  const sorted = [...meetings].sort((a, b) => {
    let cmp = 0;
    if (sort.key === 'title') cmp = (a.title || '').localeCompare(b.title || '');
    else cmp = new Date(a.start_time) - new Date(b.start_time);
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  if (loading) return (
    <div className="loading-page"><div className="spinner" /><span>Loading meetings…</span></div>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Meeting History</div>
          <div className="page-sub">{meetings.length} meeting{meetings.length !== 1 ? 's' : ''} recorded</div>
        </div>
        {activeMeetingId && (
          <div className="page-actions">
            <button className="btn btn-danger btn-sm" onClick={() => navigate('active-meeting', activeMeetingId)}>
              <Radio size={13} /> Live Meeting
            </button>
          </div>
        )}
      </div>

      <motion.div className="glass-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        {meetings.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><ClipboardList size={26} /></div>
            <div className="empty-state-title">No meetings yet</div>
            <div className="empty-state-desc">Start one from the Dashboard.</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('title')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  Title <SortArrow active={sort.key === 'title'} dir={sort.dir} />
                </th>
                <th onClick={() => toggleSort('date')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  Date <SortArrow active={sort.key === 'date'} dir={sort.dir} />
                </th>
                <th>Duration</th>
                <th>Status</th>
                <th>Venue</th>
                <th>Chaired By</th>
                <th>Entries</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(m => (
                <tr key={m.meeting_id} style={{ cursor: 'pointer' }} onClick={() => navigate('meeting-detail', m.meeting_id)}>
                  <td style={{ fontWeight: 600 }}>{m.title}</td>
                  <td className="muted">{fmtDate(m.start_time)}</td>
                  <td className="muted">{fmtDuration(m.start_time, m.end_time) || '—'}</td>
                  <td><StatusChip status={m.status} /></td>
                  <td className="muted">{m.venue || '—'}</td>
                  <td className="muted">{m.chaired_by || '—'}</td>
                  <td className="muted">{m.transcript_count ?? '—'}</td>
                  <td>
                    <button className="btn btn-secondary btn-xs" onClick={e => { e.stopPropagation(); navigate('meeting-detail', m.meeting_id); }}>
                      Open <ChevronRight size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </motion.div>
    </>
  );
}

function SortArrow({ active, dir }) {
  if (!active) return <ArrowUpDown size={11} style={{ opacity: .3, marginLeft: 4, display: 'inline' }} />;
  return dir === 'asc'
    ? <ArrowUp size={11} style={{ marginLeft: 4, display: 'inline', color: 'var(--blue)' }} />
    : <ArrowDown size={11} style={{ marginLeft: 4, display: 'inline', color: 'var(--blue)' }} />;
}

function StatusChip({ status }) {
  const map = { recording: 'chip-recording', stopped: 'chip-stopped', processing: 'chip-processing', completed: 'chip-completed' };
  return <span className={`chip ${map[status] || ''}`}>{status}</span>;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(start, end) {
  if (!start || !end) return null;
  const total = Math.round((new Date(end) - new Date(start)) / 1000);
  if (total < 1) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
