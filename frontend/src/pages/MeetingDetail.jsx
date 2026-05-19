import React, { useContext, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Sparkles, Download, RefreshCw, ArrowLeft, Clock } from 'lucide-react';
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

export default function MeetingDetail({ meetingId }) {
  const { navigate, activeMeetingId } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meeting, setMeeting]       = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [mom, setMom]               = useState(null);
  const [draftPoints, setDraftPoints] = useState(null);
  const [lowConfidenceEntries, setLowConfidenceEntries] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [genLoading, setGenLoading] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
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
      setDraftPoints(null);
      toast('MoM generated successfully', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setGenLoading(false);
    }
  }

  async function prepareMomDraft() {
    setDraftLoading(true);
    try {
      const result = await api.post('/meeting/prepare_mom_draft', { meeting_id: meetingId });
      setDraftPoints(result.draft_points);
      setLowConfidenceEntries(result.low_confidence_entries || []);
      toast('Draft points prepared. Review and edit before final MoM.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDraftLoading(false);
    }
  }

  async function generateMomFromDraft() {
    if (!draftPoints) return;
    setGenLoading(true);
    try {
      const result = await api.post('/meeting/generate_mom', {
        meeting_id: meetingId,
        draft_points: draftPoints,
      });
      setMom(result.mom);
      setDraftPoints(null);
      setLowConfidenceEntries([]);
      toast('Final MoM generated from edited points', 'success');
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
          <div className="page-sub">
            {fmtDate(meeting.start_time)}
            {' · '}{meeting.venue || 'No venue'}
          </div>
          {meeting.end_time && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 13, color: 'var(--text-2)', background: 'var(--surface-2)', borderRadius: 6, padding: '3px 10px', width: 'fit-content' }}>
              <Clock size={12} />
              <span>Duration: <strong>{fmtDuration(meeting.start_time, meeting.end_time)}</strong></span>
            </div>
          )}
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={() =>
            activeMeetingId === meetingId ? navigate('active-meeting', meetingId) : navigate('history')
          }>
            <ArrowLeft size={13} />
            {activeMeetingId === meetingId ? 'Back to Live' : 'Back'}
          </button>
          {!mom && !draftPoints && (
            <motion.button
              className="btn btn-ai"
              disabled={draftLoading || transcript.length === 0}
              onClick={prepareMomDraft}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            >
              <Sparkles size={14} />
              {draftLoading ? 'Preparing…' : 'Prepare Draft Points'}
            </motion.button>
          )}

          {!mom && draftPoints && (
            <motion.button
              className="btn btn-ai"
              disabled={genLoading}
              onClick={generateMomFromDraft}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            >
              <Sparkles size={14} />
              {genLoading ? 'Generating…' : 'Generate Final MoM'}
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
                <MomView mom={mom} startTime={meeting?.start_time} />
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
          ) : draftPoints ? (
            <div className="card-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
              <DraftPointsEditor
                draft={draftPoints}
                onChange={setDraftPoints}
                onGenerate={generateMomFromDraft}
                onRefresh={prepareMomDraft}
                draftLoading={draftLoading}
                genLoading={genLoading}
                lowConfidenceEntries={lowConfidenceEntries}
              />
            </div>
          ) : (
            <div className="generate-cta">
              <div className="generate-cta-icon">
                <Sparkles size={28} color="var(--purple)" />
              </div>
              <div className="generate-cta-title">Prepare and Review MoM Points</div>
              <div className="generate-cta-desc">
                First, AI prepares editable points from transcript. You can fix recognition issues, then generate the final MoM.
              </div>
              <motion.button
                className="btn btn-ai btn-lg"
                disabled={draftLoading || transcript.length === 0}
                onClick={prepareMomDraft}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              >
                <Sparkles size={15} />
                {draftLoading ? 'Preparing…' : 'Prepare Draft Points'}
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

function MomView({ mom, startTime }) {
  if (!mom) return null;

  // Format date/time in the browser using the local timezone (same as the page header)
  // This avoids any server-side timezone misconfiguration issues
  let displayDate = mom.date;
  let displayTime = mom.time;
  if (startTime) {
    const dt = new Date(startTime);
    displayDate = dt.toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' });
    displayTime = dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return (
    <div className="mom-inner">
      {/* ── Institutional header (mirrors the DOCX/PDF export header) ── */}
      <div style={{ textAlign: 'center', marginBottom: 16, paddingBottom: 14, borderBottom: '2px solid var(--border)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-1)' }}>
          Ghulam Ishaq Khan Institute
        </div>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginTop: 2 }}>
          of Engineering Sciences and Technology
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 8, color: 'var(--text-1)' }}>
          Minutes of Meeting
        </div>
      </div>

      <div className="mom-title">{mom.meeting_title || 'Minutes of Meeting'}</div>
      <div className="mom-subtitle">Generated by GIK MoM Assistant</div>

      <div className="mom-section-title">Meeting Details</div>
      <div className="mom-meta-grid">
        {[['Date', displayDate], ['Time', displayTime], ['Venue', mom.venue], ['Chaired By', mom.chaired_by]].map(([k, v]) => (
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

function DraftPointsEditor({ draft, onChange, onGenerate, onRefresh, draftLoading, genLoading, lowConfidenceEntries }) {
  function updateField(field, value) {
    onChange({ ...draft, [field]: value });
  }

  function updateDiscussion(idx, key, value) {
    const next = [...(draft.discussion_points || [])];
    next[idx] = { ...next[idx], [key]: value };
    updateField('discussion_points', next);
  }

  function updateAction(idx, key, value) {
    const next = [...(draft.action_items || [])];
    next[idx] = { ...next[idx], [key]: value };
    updateField('action_items', next);
  }

  const addDiscussion = () => updateField('discussion_points', [...(draft.discussion_points || []), { topic: '', summary: '', speaker: '' }]);
  const removeDiscussion = idx => updateField('discussion_points', (draft.discussion_points || []).filter((_, i) => i !== idx));

  const addAction = () => updateField('action_items', [...(draft.action_items || []), { item: '', responsible: 'TBD', deadline: 'TBD' }]);
  const removeAction = idx => updateField('action_items', (draft.action_items || []).filter((_, i) => i !== idx));

  return (
    <div className="mom-draft-editor">
      <div className="mom-draft-head">
        <div>
          <div className="mom-draft-title">Review Points Before Final MoM</div>
          <div className="mom-draft-sub">Edit anything that looks incorrect, then generate the final minutes.</div>
        </div>
        <div className="mom-draft-actions">
          <button className="btn btn-ghost btn-xs" onClick={onRefresh} disabled={draftLoading || genLoading}>
            <RefreshCw size={12} /> {draftLoading ? 'Refreshing…' : 'Rebuild Draft'}
          </button>
          <button className="btn btn-ai btn-sm" onClick={onGenerate} disabled={genLoading}>
            <Sparkles size={13} /> {genLoading ? 'Generating…' : 'Generate Final MoM'}
          </button>
        </div>
      </div>

      {lowConfidenceEntries?.length > 0 && (
        <div className="mom-lowconf-box">
          <div className="mom-lowconf-title">Low-confidence transcript segments (review these first)</div>
          <div className="mom-lowconf-list">
            {lowConfidenceEntries.slice(0, 12).map((e, idx) => (
              <div key={e.id || idx} className="mom-lowconf-item">
                <span className="mom-lowconf-meta">{fmtSpeaker(e.speaker)} · conf {Number(e.confidence).toFixed(2)}</span>
                <span>{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Meeting Title</label>
        <input className="form-control" value={draft.meeting_title || ''} onChange={e => updateField('meeting_title', e.target.value)} />
      </div>

      <div className="form-group">
        <label className="form-label">Chaired By</label>
        <input className="form-control" value={draft.chaired_by || ''} onChange={e => updateField('chaired_by', e.target.value)} />
      </div>

      <StringListEditor
        label="Attendees"
        values={draft.attendees || []}
        onChange={vals => updateField('attendees', vals)}
        placeholder="Attendee name"
      />

      <StringListEditor
        label="Agenda Items"
        values={draft.agenda_items || []}
        onChange={vals => updateField('agenda_items', vals)}
        placeholder="Agenda item"
      />

      <StringListEditor
        label="Decisions"
        values={draft.decisions || []}
        onChange={vals => updateField('decisions', vals)}
        placeholder="Decision statement"
      />

      <div className="mom-draft-section">
        <div className="mom-draft-section-head">
          <span>Discussion Points</span>
          <button className="btn btn-ghost btn-xs" onClick={addDiscussion}>Add</button>
        </div>
        {(draft.discussion_points || []).map((row, idx) => (
          <div key={idx} className="mom-draft-grid-row">
            <input className="form-control" placeholder="Topic" value={row.topic || ''} onChange={e => updateDiscussion(idx, 'topic', e.target.value)} />
            <input className="form-control" placeholder="Summary" value={row.summary || ''} onChange={e => updateDiscussion(idx, 'summary', e.target.value)} />
            <input className="form-control" placeholder="Speaker" value={row.speaker || ''} onChange={e => updateDiscussion(idx, 'speaker', e.target.value)} />
            <button className="btn btn-ghost btn-xs" onClick={() => removeDiscussion(idx)}>Remove</button>
          </div>
        ))}
      </div>

      <div className="mom-draft-section">
        <div className="mom-draft-section-head">
          <span>Action Items</span>
          <button className="btn btn-ghost btn-xs" onClick={addAction}>Add</button>
        </div>
        {(draft.action_items || []).map((row, idx) => (
          <div key={idx} className="mom-draft-grid-row">
            <input className="form-control" placeholder="Task" value={row.item || ''} onChange={e => updateAction(idx, 'item', e.target.value)} />
            <input className="form-control" placeholder="Responsible" value={row.responsible || ''} onChange={e => updateAction(idx, 'responsible', e.target.value)} />
            <input className="form-control" placeholder="Deadline" value={row.deadline || ''} onChange={e => updateAction(idx, 'deadline', e.target.value)} />
            <button className="btn btn-ghost btn-xs" onClick={() => removeAction(idx)}>Remove</button>
          </div>
        ))}
      </div>

      <div className="form-group">
        <label className="form-label">Closing Remarks</label>
        <textarea className="form-control" rows={3} value={draft.closing_remarks || ''} onChange={e => updateField('closing_remarks', e.target.value)} />
      </div>

      <div className="form-group">
        <label className="form-label">Additional Notes</label>
        <textarea className="form-control" rows={3} value={draft.additional_notes || ''} onChange={e => updateField('additional_notes', e.target.value)} />
      </div>
    </div>
  );
}

function StringListEditor({ label, values, onChange, placeholder }) {
  const add = () => onChange([...(values || []), '']);
  const update = (idx, value) => {
    const next = [...(values || [])];
    next[idx] = value;
    onChange(next);
  };
  const remove = idx => onChange((values || []).filter((_, i) => i !== idx));

  return (
    <div className="mom-draft-section">
      <div className="mom-draft-section-head">
        <span>{label}</span>
        <button className="btn btn-ghost btn-xs" onClick={add}>Add</button>
      </div>
      {(values || []).map((value, idx) => (
        <div key={idx} className="mom-draft-row">
          <input className="form-control" placeholder={placeholder} value={value || ''} onChange={e => update(idx, e.target.value)} />
          <button className="btn btn-ghost btn-xs" onClick={() => remove(idx)}>Remove</button>
        </div>
      ))}
    </div>
  );
}
