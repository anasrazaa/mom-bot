import React, { useContext, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Mic, Plus, AlignLeft, Users, Clock } from 'lucide-react';
import { AppContext, ToastContext } from '../App.jsx';
import { api } from '../api.js';

export default function LiveMeetings() {
  const { navigate, activeMeetingId, setActiveMeetingId } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);

  function fetchLive() {
    api.get('/meeting/history')
      .then(r => {
        const live = (r.meetings || []).find(m => m.status === 'recording') || null;
        setMeeting(live);
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

  function joinMeeting(id) {
    setActiveMeetingId(id);
    navigate('active-meeting', id);
  }

  if (loading) return (
    <div className="loading-page"><div className="spinner" /><span>Checking for live meetings…</span></div>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Live Meetings</div>
          <div className="page-sub">{meeting ? 'Recording is in progress' : 'No meeting currently recording'}</div>
        </div>
        {!meeting && (
          <div className="page-actions">
            <button className="btn btn-primary btn-sm" onClick={() => navigate('dashboard')}>
              <Plus size={13} /> Start New Meeting
            </button>
          </div>
        )}
      </div>

      {!meeting ? (
        <motion.div className="glass-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <div className="empty-state" style={{ padding: '80px 40px' }}>
            <div className="empty-state-icon"><Mic size={28} /></div>
            <div className="empty-state-title">No meeting in progress</div>
            <div className="empty-state-desc">Start a new meeting from the Dashboard to begin recording.</div>
            <button className="btn btn-primary" onClick={() => navigate('dashboard')}>Go to Dashboard</button>
          </div>
        </motion.div>
      ) : (
        <motion.div
          className="glass-card glow-blue"
          initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35 }}
        >
          <div className="live-hero">
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              <div className="live-pulse-wrap">
                <div className="live-pulse-ring" />
                <div className="live-pulse-ring-2" />
                <div className="live-pulse-core" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span className="chip chip-recording">● LIVE</span>
                </div>
                <div style={{ fontWeight: 800, fontSize: 20, color: 'var(--text)', marginBottom: 6, letterSpacing: '-.3px' }}>
                  {meeting.title}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                  {meeting.venue && (
                    <span style={{ fontSize: 13, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <AlignLeft size={12} /> {meeting.venue}
                    </span>
                  )}
                  {meeting.chaired_by && (
                    <span style={{ fontSize: 13, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Users size={12} /> Chaired by {meeting.chaired_by}
                    </span>
                  )}
                  <span style={{ fontSize: 13, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Clock size={12} /> Started {fmtTime(meeting.start_time)}
                  </span>
                  {meeting.transcript_count > 0 && (
                    <span style={{ fontSize: 13, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <AlignLeft size={12} /> {meeting.transcript_count} entries
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div style={{ padding: '0 36px 32px', display: 'flex', gap: 12 }}>
            {activeMeetingId === meeting.meeting_id ? (
              <motion.button
                className="btn btn-ai btn-lg"
                onClick={() => navigate('active-meeting', meeting.meeting_id)}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              >
                <Mic size={16} /> Return to Meeting
              </motion.button>
            ) : (
              <motion.button
                className="btn btn-ai btn-lg"
                onClick={() => joinMeeting(meeting.meeting_id)}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              >
                <Mic size={16} /> Join Meeting
              </motion.button>
            )}
          </div>
        </motion.div>
      )}
    </>
  );
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}


export default function LiveMeetings() {
  const { navigate, activeMeetingId, setActiveMeetingId } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);

  function fetchLive() {
    api.get('/meeting/history')
      .then(r => {
        const live = (r.meetings || []).find(m => m.status === 'recording') || null;
        setMeeting(live);
        setLoading(false);
      })
      .catch(() => { toast('Failed to load meetings', 'error'); setLoading(false); });
  }

  useEffect(() => {
    fetchLive();
    // Keep polling so the card updates transcript count and stays current
    const iv = setInterval(fetchLive, 5000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function joinMeeting(id) {
    setActiveMeetingId(id);
    navigate('active-meeting', id);
  }

  if (loading) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="page-hdr">
        <div>
          <h1>Live Meeting</h1>
          <p>{meeting ? 'Recording is in progress' : 'No meeting is currently recording'}</p>
        </div>
        {!meeting && (
          <div className="page-hdr-actions">
            <button className="btn btn-primary" onClick={() => navigate('dashboard')}>
              + Start New Meeting
            </button>
          </div>
        )}
      </div>

      {!meeting ? (
        <div className="card">
          <div className="empty" style={{ padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎙</div>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>No meeting in progress</div>
            <div className="muted" style={{ marginBottom: 20 }}>Start a new meeting from the Dashboard.</div>
            <button className="btn btn-primary" onClick={() => navigate('dashboard')}>Go to Dashboard</button>
          </div>
        </div>
      ) : (
        <div className="card live-meeting-card">
          <div className="live-meeting-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              {/* Pulsing recording indicator */}
              <div className="live-dot-wrap">
                <div className="live-dot-ring" />
                <div className="live-dot-core" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--c-text)', marginBottom: 4 }}>
                  {meeting.title}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {meeting.venue || 'No venue'}
                  {meeting.chaired_by ? ` · Chaired by ${meeting.chaired_by}` : ''}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Started {fmtTime(meeting.start_time)}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
                <span className="chip chip-recording" style={{ fontSize: 12 }}>● LIVE</span>
                {meeting.transcript_count > 0 && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {meeting.transcript_count} transcript entries
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="live-meeting-footer">
            {activeMeetingId === meeting.meeting_id ? (
              <button
                className="btn btn-primary btn-lg btn-ai"
                onClick={() => navigate('active-meeting', meeting.meeting_id)}
              >
                ▶ Return to Meeting
              </button>
            ) : (
              <button
                className="btn btn-primary btn-lg btn-ai"
                onClick={() => joinMeeting(meeting.meeting_id)}
              >
                🎙 Join Meeting
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
