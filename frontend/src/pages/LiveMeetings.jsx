import React, { useContext, useEffect, useState } from 'react';
import { AppContext, ToastContext } from '../App.jsx';
import { api } from '../api.js';

export default function LiveMeetings() {
  const { navigate } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading]   = useState(true);

  function fetchLive() {
    api.get('/meeting/history')
      .then(r => {
        setMeetings((r.meetings || []).filter(m => m.status === 'recording'));
        setLoading(false);
      })
      .catch(() => { toast('Failed to load meetings', 'error'); setLoading(false); });
  }

  useEffect(() => {
    fetchLive();
    const iv = setInterval(fetchLive, 5000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="page-hdr">
        <div>
          <h1>Live Meetings</h1>
          <p>{meetings.length} meeting{meetings.length !== 1 ? 's' : ''} currently recording</p>
        </div>
        <div className="page-hdr-actions">
          <button className="btn btn-primary" onClick={() => navigate('dashboard')}>
            + Start New Meeting
          </button>
        </div>
      </div>

      {meetings.length === 0 ? (
        <div className="card">
          <div className="empty" style={{ padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎙</div>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>No meetings in progress</div>
            <div className="muted" style={{ marginBottom: 20 }}>Start a new meeting from the Dashboard.</div>
            <button className="btn btn-primary" onClick={() => navigate('dashboard')}>Go to Dashboard</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {meetings.map(m => (
            <div key={m.meeting_id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {/* Pulsing red dot */}
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%',
                    background: 'rgba(248,81,73,.15)', border: '2px solid rgba(248,81,73,.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%',
                      background: 'var(--c-danger)', animation: 'blink 1s infinite',
                    }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{m.title}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {m.venue || 'No venue'}
                      {m.chaired_by ? ` · Chaired by ${m.chaired_by}` : ''}
                      {' · Started '}{fmtDate(m.start_time)}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span className="chip chip-recording">LIVE</span>
                  <button
                    className="btn btn-danger btn-lg"
                    onClick={() => navigate('active-meeting', m.meeting_id)}
                  >
                    🎙 Join Meeting
                  </button>
                </div>
              </div>
              {m.transcript_count > 0 && (
                <div style={{
                  borderTop: '1px solid var(--c-border)',
                  padding: '8px 24px',
                  background: 'var(--c-surface2)',
                  fontSize: 12, color: 'var(--c-muted)',
                }}>
                  {m.transcript_count} transcript {m.transcript_count === 1 ? 'entry' : 'entries'} so far
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
