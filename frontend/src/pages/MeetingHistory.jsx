import React, { useContext, useEffect, useState } from 'react';
import { AppContext, ToastContext } from '../App.jsx';
import { api } from '../api.js';

export default function MeetingHistory() {
  const { navigate } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    api.get('/meeting/history')
      .then(r => { setMeetings(r.meetings || []); setLoading(false); })
      .catch(() => { toast('Failed to load meetings', 'error'); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
                <th>Status</th>
                <th>Venue</th>
                <th>Chaired By</th>
                <th>Entries</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map(m => (
                <tr key={m.meeting_id}>
                  <td style={{ fontWeight: 600 }}>{m.title}</td>
                  <td>{fmtDate(m.start_time)}</td>
                  <td><StatusChip status={m.status} /></td>
                  <td className="muted">{m.venue || '—'}</td>
                  <td className="muted">{m.chaired_by || '—'}</td>
                  <td>{m.transcript_count ?? '—'}</td>
                  <td>
                    <button className="btn btn-outline btn-sm"
                      onClick={() => navigate('meeting-detail', m.meeting_id)}>Open</button>
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
