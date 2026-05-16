import React, { useContext, useEffect, useState } from 'react';
import { AppContext, ToastContext } from '../App.jsx';
import { api } from '../api.js';

export default function MeetingHistory() {
  const { navigate } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    api.get('/meetings')
      .then(m => { setMeetings(Array.isArray(m) ? m : []); setLoading(false); })
      .catch(() => { toast('Failed to load meetings', 'error'); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deleteMeeting(id) {
    if (!confirm('Delete this meeting and all its data?')) return;
    setDeleting(id);
    try {
      await api.delete(`/meetings/${id}`);
      setMeetings(m => m.filter(x => x.id !== id));
      toast('Meeting deleted', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDeleting(null);
    }
  }

  if (loading) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="page-hdr">
        <div>
          <h1>Meeting History</h1>
          <p>{meetings.length} meeting{meetings.length !== 1 ? 's' : ''} recorded</p>
        </div>
      </div>

      <div className="card">
        {meetings.length === 0 ? (
          <div className="empty-cell">No meetings yet — start one from the Dashboard.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Date</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Location</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map(m => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.title}</td>
                  <td>{fmtDate(m.created_at)}</td>
                  <td>{m.duration_s ? fmtDuration(m.duration_s) : '—'}</td>
                  <td><StatusChip status={m.status} /></td>
                  <td className="muted">{m.location || '—'}</td>
                  <td>
                    <div className="tbl-actions">
                      <button className="btn btn-outline btn-sm" onClick={() => navigate('meeting-detail', m.id)}>Open</button>
                      <button
                        className="btn btn-danger btn-sm"
                        disabled={deleting === m.id}
                        onClick={() => deleteMeeting(m.id)}
                      >
                        {deleting === m.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function StatusChip({ status }) {
  const map = { recording: 'chip-recording', stopped: 'chip-stopped', processing: 'chip-processing', completed: 'chip-completed' };
  return <span className={`chip ${map[status] || ''}`}>{status}</span>;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(s) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}m ${sec}s`;
}
