import React, { useContext, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Sparkles, Download, RefreshCw, ArrowLeft } from 'lucide-react';
import { AppContext, ToastContext } from '../App.jsx';
import { api } from '../api.js';

const SPK_COLOURS = ['#388bfd','#3fb950','#d29922','#f78166','#a5d6ff','#7ee787','#ffa657','#ff7b72','#d2a8ff','#79c0ff'];
function spkColour(label) {
  let h = 0;
  for (let i = 0; i < (label||'').length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return SPK_COLOURS[h % SPK_COLOURS.length];
}
function fmtSpeaker(raw) {
  if (!raw) return 'Unknown Speaker';
  const m = raw.match(/^SPEAKER_0*(\d+)$/i);
  if (m) return `Speaker ${parseInt(m[1], 10) + 1}`;
  return raw;
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function MeetingDetail({ meetingId }) {
  const { navigate, activeMeetingId } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meeting, setMeeting]       = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [mom, setMom]               = useState(null);
  const [loading, setLoading]       = useState(true);
  const [genLoading, setGenLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState('');

  useEffect(() => {
    if (!meetingId) { navigate('history'); return; }
    Promise.all([
      api.get(`/meeting/${meetingId}`),
      api.get(`/transcript/${meetingId}`).catch(() => ({ entries: [] })),
      api.get(`/meeting/${meetingId}/mom`).catch(() => null),
    ]).then(([m, txResp, momResp]) => {
      setMeeting(m);
      setTranscript(txResp.entries || []);
      if (momResp?.mom) setMom(momResp.mom);
      setLoading(false);
    }).catch(() => { toast('Failed to load meeting', 'error'); navigate('history'); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  async function generateMom() {
    setGenLoading(true);
    try {
      const result = await api.post('/meeting/generate_mom', { meeting_id: meetingId });
      setMom(result.mom);
      toast('MoM generated successfully', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setGenLoading(false);
    }
  }

  async function exportDoc(fmt) {
    setExportLoading(fmt);
    try {
      const resp = await fetch(`/export/${meetingId}/${fmt}`);
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `${meeting?.title || 'minutes'}.${fmt}`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Exported as .${fmt}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setExportLoading('');
    }
  }

  function fmtEntryTime(entry) {
    if (entry.start_time != null) return new Date(entry.start_time * 1000).toISOString().substr(11, 8);
    if (entry.timestamp) return new Date(entry.timestamp).toISOString().substr(11, 8);
    return '';
  }

  if (loading) return (
    <div className="loading-page"><div className="spinner" /><span>Loading meeting…</span></div>
  );
  if (!meeting) return null;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{meeting.title}</div>
          <div className="page-sub">{fmtDate(meeting.start_time)} · {meeting.venue || 'No venue'}</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={() =>
            activeMeetingId === meetingId ? navigate('active-meeting', meetingId) : navigate('history')
          }>
            <ArrowLeft size={13} />
            {activeMeetingId === meetingId ? 'Back to Live' : 'Back'}
          </button>
          {!mom && (
            <motion.button
              className="btn btn-ai"
              disabled={genLoading || transcript.length === 0}
              onClick={generateMom}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            >
              <Sparkles size={14} />
              {genLoading ? 'Generating…' : 'Generate MoM'}
            </motion.button>
          )}
        </div>
      </div>

      <div className="detail-grid">
        {/* ── Transcript ─────────────────────────────────────────────── */}
        <motion.div className="glass-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <div className="card-header">
            <div className="card-header-left">
              <div className="card-header-icon"><FileText size={13} /></div>
              Transcript
            </div>
            <span className="badge">{transcript.length}</span>
          </div>
          <div className="transcript-static">
            {transcript.length === 0 ? (
              <div className="empty-state" style={{ padding: '28px 0' }}>
                <div className="empty-state-title">No transcript available</div>
              </div>
            ) : (
              transcript.map((entry, i) => {
                const col = spkColour(entry.speaker || 'Unknown');
                return (
                  <div key={i} className="tx-static-entry" style={{ borderLeftColor: col }}>
                    <div>
                      <div className="tx-static-spk" style={{ color: col }}>{fmtSpeaker(entry.speaker)}</div>
                      <div className="tx-static-text">{entry.text}</div>
                      <div className="tx-static-time">{fmtEntryTime(entry)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>

        {/* ── MoM panel ─────────────────────────────────────────────── */}
        <motion.div className="glass-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.08 }}>
          {mom ? (
            <>
              <div className="card-header">
                <div className="card-header-left">
                  <div className="card-header-icon" style={{ background: 'var(--purple-dim)', color: 'var(--purple)' }}>
                    <Sparkles size={13} />
                  </div>
                  Minutes of Meeting
                </div>
                <button className="btn btn-ghost btn-xs" onClick={generateMom} disabled={genLoading}>
                  <RefreshCw size={12} /> {genLoading ? '…' : 'Regenerate'}
                </button>
              </div>
              <div style={{ maxHeight: '65vh', overflowY: 'auto' }}>
                <MomView mom={mom} />
              </div>
              <div className="export-row">
                <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} disabled={exportLoading === 'docx'} onClick={() => exportDoc('docx')}>
                  <Download size={13} /> {exportLoading === 'docx' ? 'Exporting…' : 'Export DOCX'}
                </button>
                <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} disabled={exportLoading === 'pdf'} onClick={() => exportDoc('pdf')}>
                  <Download size={13} /> {exportLoading === 'pdf' ? 'Exporting…' : 'Export PDF'}
                </button>
              </div>
            </>
          ) : (
            <div className="generate-cta">
              <div className="generate-cta-icon">
                <Sparkles size={28} color="var(--purple)" />
              </div>
              <div className="generate-cta-title">Generate Minutes of Meeting</div>
              <div className="generate-cta-desc">
                The AI will analyse the transcript and produce structured MoM with decisions, action items, and a summary.
              </div>
              <motion.button
                className="btn btn-ai btn-lg"
                disabled={genLoading || transcript.length === 0}
                onClick={generateMom}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              >
                <Sparkles size={15} />
                {genLoading ? 'Generating…' : 'Generate MoM'}
              </motion.button>
              {transcript.length === 0 && (
                <div className="text-3" style={{ fontSize: 12, marginTop: 10 }}>No transcript available — record a meeting first.</div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </>
  );
}

function MomView({ mom }) {
  if (!mom) return null;
  return (
    <div className="mom-inner">
      <div className="mom-title">{mom.meeting_title || 'Minutes of Meeting'}</div>
      <div className="mom-subtitle">Generated by GIK MoM Assistant</div>

      <div className="mom-section-title">Meeting Details</div>
      <div className="mom-meta-grid">
        {[['Date', mom.date], ['Time', mom.time], ['Venue', mom.venue], ['Chaired By', mom.chaired_by]].map(([k, v]) => (
          <div key={k}>
            <div className="mom-meta-key">{k}</div>
            <div className="mom-meta-val">{v || '—'}</div>
          </div>
        ))}
      </div>

      {mom.attendees?.length > 0 && (
        <><div className="mom-divider" /><div className="mom-section-title">Attendees</div>
          {mom.attendees.map((a, i) => <div key={i} className="mom-list-item">{a}</div>)}</>
      )}

      {mom.agenda_items?.length > 0 && (
        <><div className="mom-divider" /><div className="mom-section-title">Agenda</div>
          {mom.agenda_items.map((a, i) => <div key={i} className="mom-list-item">{i + 1}. {a}</div>)}</>
      )}

      {mom.discussion_summary?.length > 0 && (
        <><div className="mom-divider" /><div className="mom-section-title">Discussion Points</div>
          {mom.discussion_summary.map((d, i) => (
            <div key={i} className="mom-discussion">
              <div className="mom-discussion-title">{d.topic}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{d.summary}</div>
            </div>
          ))}</>
      )}

      {mom.decisions?.length > 0 && (
        <><div className="mom-divider" /><div className="mom-section-title">Decisions Made</div>
          {mom.decisions.map((d, i) => (
            <div key={i} className="mom-decision">{d.decision}{d.made_by ? ` — ${d.made_by}` : ''}</div>
          ))}</>
      )}

      {mom.action_items?.length > 0 && (
        <><div className="mom-divider" /><div className="mom-section-title">Action Items</div>
          <table className="mom-action-table">
            <thead><tr><th>#</th><th>Task</th><th>Responsible</th><th>Deadline</th></tr></thead>
            <tbody>
              {mom.action_items.map((item, i) => (
                <tr key={i}><td>{i + 1}</td><td>{item.item}</td><td>{item.responsible}</td><td>{item.deadline || 'TBD'}</td></tr>
              ))}
            </tbody>
          </table></>
      )}

      {mom.closing_remarks && (
        <><div className="mom-divider" /><div className="mom-section-title">Closing Remarks</div>
          <p style={{ fontSize: 13.5 }}>{mom.closing_remarks}</p></>
      )}
    </div>
  );
}
