import React, { useContext, useEffect, useState } from 'react';
import { AppContext, ToastContext } from '../App.jsx';
import { api } from '../api.js';

const SPK_COLOURS = [
  '#388bfd','#3fb950','#d29922','#f78166','#a5d6ff',
  '#7ee787','#ffa657','#ff7b72','#d2a8ff','#79c0ff',
];
function spkColour(label) {
  let h = 0;
  for (let i = 0; i < (label||'').length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return SPK_COLOURS[h % SPK_COLOURS.length];
}

export default function MeetingDetail({ meetingId }) {
  const { navigate } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meeting, setMeeting]       = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [mom, setMom]               = useState(null);
  const [speakers, setSpeakers]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [genLoading, setGenLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState('');

  useEffect(() => {
    if (!meetingId) { navigate('history'); return; }
    Promise.all([
      api.get(`/meetings/${meetingId}`),
      api.get(`/transcript/${meetingId}`).catch(() => []),
      api.get(`/mom/${meetingId}`).catch(() => null),
      api.get('/speakers').catch(() => []),
    ]).then(([m, tx, mo, spk]) => {
      setMeeting(m);
      setTranscript(Array.isArray(tx) ? tx : []);
      setMom(mo);
      setSpeakers(Array.isArray(spk) ? spk : []);
      setLoading(false);
    }).catch(() => { toast('Failed to load meeting', 'error'); navigate('history'); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  async function generateMom() {
    setGenLoading(true);
    try {
      const result = await api.post(`/mom/${meetingId}/generate`);
      setMom(result);
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
      const resp = await fetch(`/mom/${meetingId}/export?format=${fmt}`);
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
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

  const spkMap = {};
  speakers.forEach(s => { spkMap[s.label] = s.name || s.label; });

  if (loading) return <div className="empty">Loading…</div>;
  if (!meeting) return null;

  return (
    <>
      <div className="page-hdr">
        <div>
          <h1>{meeting.title}</h1>
          <p>{fmtDate(meeting.created_at)} &nbsp;·&nbsp; {meeting.location || 'No location'}</p>
        </div>
        <div className="page-hdr-actions">
          <button className="btn btn-ghost" onClick={() => navigate('history')}>← Back</button>
          {!mom && (
            <button className="btn btn-primary" disabled={genLoading || transcript.length === 0} onClick={generateMom}>
              {genLoading ? 'Generating…' : '✦ Generate MoM'}
            </button>
          )}
        </div>
      </div>

      <div className="dash-grid">
        {/* Transcript panel */}
        <div className="card">
          <div className="card-hdr">
            Transcript
            <span className="badge">{transcript.length}</span>
          </div>
          <div className="tx-box" style={{ maxHeight: 520 }}>
            {transcript.length === 0 ? (
              <div className="tx-waiting"><span>No transcript available</span></div>
            ) : (
              transcript.map((entry, i) => {
                const col = spkColour(entry.speaker || 'Unknown');
                return (
                  <div key={i} className="tx-entry" style={{ borderLeftColor: col, background: col + '14' }}>
                    <div className="tx-speaker" style={{ color: col }}>
                      {spkMap[entry.speaker] || entry.speaker || 'Unknown'}
                    </div>
                    <div className="tx-text">{entry.text}</div>
                    <div className="tx-ts">{entry.timestamp ? new Date(entry.timestamp * 1000).toISOString().substr(11,8) : ''}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* MoM + export */}
        <div>
          {mom ? (
            <div className="card">
              <div className="card-hdr">
                Minutes of Meeting
                <button className="btn btn-ghost btn-sm" onClick={generateMom} disabled={genLoading}>
                  {genLoading ? '…' : '↺ Regenerate'}
                </button>
              </div>
              <MomView mom={mom} />
              <div className="export-btns">
                <button className="btn btn-outline btn-w" disabled={exportLoading === 'docx'} onClick={() => exportDoc('docx')}>
                  📄 {exportLoading === 'docx' ? 'Exporting…' : 'Export DOCX'}
                </button>
                <button className="btn btn-outline btn-w" disabled={exportLoading === 'pdf'} onClick={() => exportDoc('pdf')}>
                  📑 {exportLoading === 'pdf' ? 'Exporting…' : 'Export PDF'}
                </button>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="generate-section" style={{ alignItems: 'center', textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 48 }}>✦</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginTop: 12 }}>Generate Minutes of Meeting</div>
                <div className="muted" style={{ fontSize: 13, margin: '8px 0 20px' }}>
                  The AI will analyse the transcript and produce structured MoM with decisions, action items, and a summary.
                </div>
                <button
                  className="btn btn-primary btn-lg"
                  disabled={genLoading || transcript.length === 0}
                  onClick={generateMom}
                >
                  {genLoading ? 'Generating…' : '✦ Generate MoM'}
                </button>
                {transcript.length === 0 && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>No transcript — record a meeting first.</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Render structured MoM JSON ──────────────────────────────────────────── */
function MomView({ mom }) {
  if (!mom) return null;
  const d = typeof mom.content === 'string' ? (() => { try { return JSON.parse(mom.content); } catch { return null; } })() : mom.content;
  if (!d) return <pre className="mono" style={{ padding: 16, whiteSpace: 'pre-wrap' }}>{mom.content}</pre>;

  return (
    <div className="mom-preview">
      <h2>{d.title || 'Minutes of Meeting'}</h2>
      <div className="mom-inst">Generated by GIK MoM Assistant</div>

      {d.metadata && (
        <>
          <div className="mom-section-hdr">Meeting Details</div>
          <div className="mom-meta-grid">
            {Object.entries(d.metadata).map(([k, v]) => (
              <div key={k}>
                <div className="mom-meta-k">{k}</div>
                <div className="mom-meta-v">{String(v)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {d.summary && (
        <>
          <div className="mom-divider" />
          <div className="mom-section-hdr">Executive Summary</div>
          <p style={{ fontSize: 13.5, lineHeight: 1.7 }}>{d.summary}</p>
        </>
      )}

      {d.attendees?.length > 0 && (
        <>
          <div className="mom-divider" />
          <div className="mom-section-hdr">Attendees</div>
          {d.attendees.map((a, i) => <div key={i} className="mom-list-item">{a}</div>)}
        </>
      )}

      {d.agenda?.length > 0 && (
        <>
          <div className="mom-divider" />
          <div className="mom-section-hdr">Agenda</div>
          {d.agenda.map((a, i) => <div key={i} className="mom-list-item">{i + 1}. {a}</div>)}
        </>
      )}

      {d.discussions?.length > 0 && (
        <>
          <div className="mom-divider" />
          <div className="mom-section-hdr">Discussion Points</div>
          {d.discussions.map((disc, i) => (
            <div key={i} className="mom-discussion">
              <div className="mom-discussion-t">{disc.topic}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{disc.summary}</div>
            </div>
          ))}
        </>
      )}

      {d.decisions?.length > 0 && (
        <>
          <div className="mom-divider" />
          <div className="mom-section-hdr">Decisions Made</div>
          {d.decisions.map((dec, i) => <div key={i} className="mom-decision">{dec}</div>)}
        </>
      )}

      {d.action_items?.length > 0 && (
        <>
          <div className="mom-divider" />
          <div className="mom-section-hdr">Action Items</div>
          <table className="mom-action-tbl">
            <thead><tr><th>#</th><th>Task</th><th>Owner</th><th>Due</th></tr></thead>
            <tbody>
              {d.action_items.map((item, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{item.task || item}</td>
                  <td>{item.owner || '—'}</td>
                  <td>{item.due || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
