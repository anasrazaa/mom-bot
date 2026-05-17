import React, { useContext, useEffect, useState } from 'react';
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

  if (loading) return <div className="empty">Loading…</div>;
  if (!meeting) return null;

  return (
    <>
      <div className="page-hdr">
        <div>
          <h1>{meeting.title}</h1>
          <p>{fmtDate(meeting.start_time)} &nbsp;·&nbsp; {meeting.venue || 'No venue'}</p>
        </div>
        <div className="page-hdr-actions">
          <button className="btn btn-ghost" onClick={() =>
            activeMeetingId === meetingId
              ? navigate('active-meeting', meetingId)
              : navigate('history')
          }>
            {activeMeetingId === meetingId ? '← Back to Live Meeting' : '← Back'}
          </button>
          {!mom && (
            <button className="btn btn-primary" disabled={genLoading || transcript.length === 0} onClick={generateMom}>
              {genLoading ? 'Generating…' : '✦ Generate MoM'}
            </button>
          )}
        </div>
      </div>

      <div className="dash-grid">
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
                    <div className="tx-speaker" style={{ color: col }}>{fmtSpeaker(entry.speaker)}</div>
                    <div className="tx-text">{entry.text}</div>
                    <div className="tx-ts">{fmtEntryTime(entry)}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>

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
                <button className="btn btn-primary btn-lg" disabled={genLoading || transcript.length === 0} onClick={generateMom}>
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

function MomView({ mom }) {
  if (!mom) return null;
  return (
    <div className="mom-preview">
      <h2>{mom.meeting_title || 'Minutes of Meeting'}</h2>
      <div className="mom-inst">Generated by GIK MoM Assistant</div>

      <div className="mom-section-hdr">Meeting Details</div>
      <div className="mom-meta-grid">
        <div><div className="mom-meta-k">Date</div><div className="mom-meta-v">{mom.date}</div></div>
        <div><div className="mom-meta-k">Time</div><div className="mom-meta-v">{mom.time}</div></div>
        <div><div className="mom-meta-k">Venue</div><div className="mom-meta-v">{mom.venue}</div></div>
        <div><div className="mom-meta-k">Chaired By</div><div className="mom-meta-v">{mom.chaired_by}</div></div>
      </div>

      {mom.attendees?.length > 0 && (
        <>
          <div className="mom-divider" />
          <div className="mom-section-hdr">Attendees</div>
          {mom.attendees.map((a, i) => <div key={i} className="mom-list-item">{a}</div>)}
        </>
      )}

      {mom.agenda_items?.length > 0 && (
        <>
          <div className="mom-divider" />
          <div className="mom-section-hdr">Agenda</div>
          {mom.agenda_items.map((a, i) => <div key={i} className="mom-list-item">{i + 1}. {a}</div>)}
        </>
      )}

      {mom.discussion_summary?.length > 0 && (
        <>
          <div className="mom-divider" />
          <div className="mom-section-hdr">Discussion Points</div>
          {mom.discussion_summary.map((d, i) => (
            <div key={i} className="mom-discussion">
              <div className="mom-discussion-t">{d.topic}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{d.summary}</div>
            </div>
          ))}
        </>
      )}

      {mom.decisions?.length > 0 && (
        <>
          <div className="mom-divider" />
          <div className="mom-section-hdr">Decisions Made</div>
          {mom.decisions.map((d, i) => (
            <div key={i} className="mom-decision">{d.decision}{d.made_by ? ` — ${d.made_by}` : ''}</div>
          ))}
        </>
      )}

      {mom.action_items?.length > 0 && (
        <>
          <div className="mom-divider" />
          <div className="mom-section-hdr">Action Items</div>
          <table className="mom-action-tbl">
            <thead><tr><th>#</th><th>Task</th><th>Responsible</th><th>Deadline</th></tr></thead>
            <tbody>
              {mom.action_items.map((item, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{item.item}</td>
                  <td>{item.responsible}</td>
                  <td>{item.deadline || 'TBD'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {mom.closing_remarks && (
        <>
          <div className="mom-divider" />
          <div className="mom-section-hdr">Closing Remarks</div>
          <p style={{ fontSize: 13.5 }}>{mom.closing_remarks}</p>
        </>
      )}
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
