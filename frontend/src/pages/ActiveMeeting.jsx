import React, { useContext, useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Mic, MicOff, Square, FileText, Zap, Users, Clock,
  AlignLeft, CheckSquare, Pencil, Sparkles, ChevronRight,
} from 'lucide-react';
import { AppContext, ToastContext } from '../App.jsx';
import { api, wsUrl } from '../api.js';

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
function fmtTime(s) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function fmtEntryTime(entry) {
  if (entry.start_time != null) return new Date(entry.start_time * 1000).toISOString().substr(11, 8);
  if (entry.timestamp) return new Date(entry.timestamp).toISOString().substr(11, 8);
  return '';
}

/* ── Inline editable field ───────────────────────────────────────────────── */
function InlineField({ label, value, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value || '');
  const inputRef = useRef();

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(value || ''); }, [value]);

  function commit() {
    setEditing(false);
    if (draft.trim() !== (value || '').trim()) onSave(draft.trim());
  }

  return (
    <div className="info-row">
      <span className="info-key">{label}</span>
      <span className="info-val">
        {editing ? (
          <div className="info-edit-row">
            <input
              ref={inputRef}
              className="info-edit-input"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setDraft(value || ''); } }}
            />
          </div>
        ) : (
          <div className="info-edit-row">
            <span>{value || <span className="text-3" style={{ fontSize: 12 }}>—</span>}</span>
            {canEdit && (
              <span className="edit-icon" title="Edit" onClick={() => setEditing(true)}>
                <Pencil size={11} />
              </span>
            )}
          </div>
        )}
      </span>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */
export default function ActiveMeeting({ meetingId }) {
  const { navigate, setActiveMeetingId } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meeting, setMeeting]         = useState(null);
  const [transcript, setTranscript]   = useState([]);
  const [actionItems, setActionItems] = useState([]);
  const [newEntryIds, setNewEntryIds] = useState(new Set());
  const [micActive, setMicActive]     = useState(false);
  const [elapsed, setElapsed]         = useState(0);
  const [loading, setLoading]         = useState(true);
  const [autoStartMic, setAutoStartMic] = useState(false);
  const [summary, setSummary]         = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const summaryTimerRef = useRef(null);

  const audioCtxRef  = useRef(null);
  const workletRef   = useRef(null);
  const analyserRef  = useRef(null);
  const sourceRef    = useRef(null);
  const streamRef    = useRef(null);
  const audioWsRef   = useRef(null);
  const txWsRef      = useRef(null);
  const canvasRef    = useRef(null);
  const animRef      = useRef(null);
  const txEndRef     = useRef(null);
  const timerRef     = useRef(null);
  const startTimeRef = useRef(null);
  const micActiveRef = useRef(false);

  /* ── Load ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!meetingId) { navigate('dashboard'); return; }
    Promise.all([
      api.get(`/meeting/${meetingId}`),
      api.get(`/transcript/${meetingId}`).catch(() => ({ entries: [] })),
      api.get(`/meeting/${meetingId}/action-items`).catch(() => ({ items: [] })),
    ]).then(([m, txResp, aiResp]) => {
      setMeeting(m);
      setTranscript(txResp.entries || []);
      setActionItems(aiResp.items || []);
      setLoading(false);
      if (m.status === 'recording') {
        setActiveMeetingId(m.meeting_id);
        openTranscriptWs(m.meeting_id);
        const startMs = new Date(m.start_time).getTime();
        startTimeRef.current = startMs;
        setElapsed(Math.floor((Date.now() - startMs) / 1000));
        clearInterval(timerRef.current);
        timerRef.current = setInterval(
          () => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)),
          1000,
        );
        setAutoStartMic(true);
      }
    }).catch(() => { toast('Failed to load meeting', 'error'); navigate('dashboard'); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  useEffect(() => { txEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [transcript]);
  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!meetingId) return;
    async function fetchSummary() {
      if (summaryLoading) return;
      setSummaryLoading(true);
      try {
        const data = await api.get(`/chat/summary/${meetingId}`);
        setSummary(data);
      } catch { /* silently ignore */ }
      finally { setSummaryLoading(false); }
    }
    fetchSummary();
    summaryTimerRef.current = setInterval(fetchSummary, 60000);
    return () => clearInterval(summaryTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  useEffect(() => {
    if (autoStartMic && !micActiveRef.current) {
      setAutoStartMic(false);
      startMic();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartMic]);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
        if (micActiveRef.current && (!audioWsRef.current || audioWsRef.current.readyState > WebSocket.OPEN)) {
          reconnectAudioWs();
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Inline field save ───────────────────────────────────────────────── */
  async function saveField(field, val) {
    try {
      const updated = await api.patch(`/meeting/${meetingId}`, { [field]: val });
      setMeeting(updated);
      toast(`${field === 'venue' ? 'Venue' : 'Chair'} updated`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ── Transcript WS ───────────────────────────────────────────────────── */
  function openTranscriptWs(id) {
    if (txWsRef.current) return;
    const ws = new WebSocket(wsUrl(`/transcript/ws/${id}`));
    txWsRef.current = ws;
    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'action_item') {
          setActionItems(prev => {
            if (prev.find(x => x.id === msg.data.id)) return prev;
            return [...prev, msg.data];
          });
          return;
        }
        const entry = msg.type === 'transcript' ? msg.data : msg;
        if (!entry.text) return;
        const eid = entry.id || `${Date.now()}`;
        setTranscript(t => [...t, { ...entry, _eid: eid }]);
        setNewEntryIds(s => new Set([...s, eid]));
        setTimeout(() => setNewEntryIds(s => { const n = new Set(s); n.delete(eid); return n; }), 1800);
      } catch { /* ignore */ }
    };
    ws.onerror = () => toast('Transcript stream disconnected', 'warn');
    ws.onclose = () => { txWsRef.current = null; };
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      else clearInterval(pingInterval);
    }, 25000);
    ws._pingInterval = pingInterval;
  }

  /* ── Waveform ────────────────────────────────────────────────────────── */
  function startWaveform() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    const buf = new Uint8Array(analyser.frequencyBinCount);
    function draw() {
      animRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(buf);
      const W = canvas.width, H = canvas.height;
      ctx.fillStyle = '#020408'; ctx.fillRect(0, 0, W, H);
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#1f6feb'); grad.addColorStop(.5, '#388bfd'); grad.addColorStop(1, '#3fb950');
      ctx.lineWidth = 2; ctx.strokeStyle = grad;
      ctx.shadowBlur = 8; ctx.shadowColor = '#388bfd';
      ctx.beginPath();
      const step = W / buf.length;
      for (let i = 0; i < buf.length; i++) {
        const y = (buf[i] / 255) * H;
        i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * step, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    draw();
  }

  function stopWaveform() {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    const canvas = canvasRef.current;
    if (canvas) { const ctx = canvas.getContext('2d'); ctx.fillStyle = '#020408'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  }

  /* ── Mic ─────────────────────────────────────────────────────────────── */
  function connectAudioWs() {
    const ws = new WebSocket(wsUrl(`/meeting/ws/audio/${meetingId}`));
    audioWsRef.current = ws; ws.binaryType = 'arraybuffer';
    workletRef.current.port.onmessage = ev => { if (ws.readyState === WebSocket.OPEN) ws.send(ev.data); };
    ws.onopen  = () => startWaveform();
    ws.onerror = () => toast('Audio stream error', 'error');
    ws.onclose = () => {
      if (micActiveRef.current) {
        setTimeout(() => { if (micActiveRef.current) reconnectAudioWs(); }, 1500);
      }
    };
  }

  function reconnectAudioWs() {
    if (audioWsRef.current) {
      try { audioWsRef.current.close(); } catch { /* ignore */ }
      audioWsRef.current = null;
    }
    if (!workletRef.current) return;
    connectAudioWs();
  }

  const startMic = useCallback(async () => {
    if (!meetingId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 }, video: false })
        .catch(err => {
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
            throw new Error('Microphone access denied. Click the lock icon in your browser address bar, set Microphone to "Allow", then reload.');
          if (err.name === 'NotFoundError')
            throw new Error('No microphone found. Please connect a microphone and try again.');
          throw err;
        });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = ctx;
      await ctx.audioWorklet.addModule('/audio-processor.js');
      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, 'audio-processor');
      const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
      analyserRef.current = analyser;
      source.connect(analyser); source.connect(worklet);
      sourceRef.current = source; workletRef.current = worklet;
      connectAudioWs();
      openTranscriptWs(meetingId);
      micActiveRef.current = true;
      setMicActive(true);
      toast('Microphone active — recording', 'success');
    } catch (err) { toast(err.message, 'error'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  function stopMic() {
    micActiveRef.current = false;
    clearInterval(timerRef.current);
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    workletRef.current?.disconnect(); sourceRef.current?.disconnect();
    analyserRef.current = null; audioCtxRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (audioWsRef.current?.readyState === WebSocket.OPEN) audioWsRef.current.close();
    audioWsRef.current = null; workletRef.current = null; sourceRef.current = null;
    audioCtxRef.current = null; streamRef.current = null;
    stopWaveform(); setMicActive(false);
  }

  function stopAll() {
    stopMic();
    if (txWsRef.current) {
      if (txWsRef.current._pingInterval) clearInterval(txWsRef.current._pingInterval);
      txWsRef.current.close();
      txWsRef.current = null;
    }
  }

  async function stopMeeting() {
    stopAll();
    try {
      await api.post(`/meeting/${meetingId}/stop`);
      setActiveMeetingId(null);
      toast('Meeting stopped — processing transcript', 'info');
      navigate('meeting-detail', meetingId);
    } catch (err) { toast(err.message, 'error'); }
  }

  if (loading) return (
    <div className="loading-page">
      <div className="spinner" />
      <span>Loading meeting…</span>
    </div>
  );
  if (!meeting) return null;

  const isRecording = meeting.status === 'recording';
  const uniqueSpeakers = [...new Set(transcript.map(t => t.speaker).filter(Boolean))];
  const wordCount = transcript.reduce((n, e) => n + (e.text || '').split(/\s+/).filter(Boolean).length, 0);

  return (
    <>
      {/* ── Top header ────────────────────────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            {isRecording && (
              <div className="rec-badge-pill">
                <div className="live-badge-dot" />
                REC
              </div>
            )}
            <div className="page-title" style={{ fontSize: 22 }}>{meeting.title}</div>
          </div>
          <div className="meeting-stats-row">
            <div className="meeting-stat-pill"><Clock size={12} /><strong>{fmtTime(elapsed)}</strong></div>
            <div className="meeting-stat-pill"><AlignLeft size={12} /><strong>{transcript.length}</strong> entries</div>
            <div className="meeting-stat-pill"><Users size={12} /><strong>{uniqueSpeakers.length}</strong> speakers</div>
            <div className="meeting-stat-pill"><FileText size={12} /><strong>{wordCount}</strong> words</div>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('meeting-detail', meetingId)}>
            <FileText size={13} /> View Detail
          </button>
          <motion.button
            className="btn btn-danger"
            onClick={stopMeeting}
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          >
            <Square size={13} /> Stop Meeting
          </motion.button>
        </div>
      </div>

      <div className="meeting-layout">
        {/* ── Left: Live Transcript ─────────────────────────────────── */}
        <div className="transcript-panel">
          <div className="transcript-panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={14} />
              Live AI Transcript
            </div>
            <span className="badge">{transcript.length}</span>
          </div>

          <div className="transcript-scroll">
            {transcript.length === 0 ? (
              <div className="tx-waiting-state">
                <div className="pulse-ring-anim" />
                <span style={{ fontSize: 14 }}>Waiting for speech…</span>
                <span className="text-3" style={{ fontSize: 12 }}>Start your microphone below</span>
              </div>
            ) : (
              transcript.map((entry, i) => {
                const eid   = entry._eid || entry.id || i;
                const isNew = newEntryIds.has(eid);
                const col   = spkColour(entry.speaker || '');
                const lang  = entry.language;
                return (
                  <div key={i} className={`tx-entry${isNew ? ' new-entry' : ''}`}>
                    <div
                      className={`tx-orb${isNew ? ' glow' : ''}`}
                      style={{ background: col, '--orb-color': col }}
                    >
                      {fmtSpeaker(entry.speaker).charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="tx-speaker-name" style={{ color: col }}>
                        {fmtSpeaker(entry.speaker)}
                        {isNew && <span className="tx-now-tag">◈ now</span>}
                      </div>
                      <div className="tx-text">{entry.text}</div>
                      <div className="tx-footer">
                        <span className="tx-time">{fmtEntryTime(entry)}</span>
                        {lang && <span className="lang-tag">{lang === 'ur' || lang === 'urdu' ? 'اردو' : lang.toUpperCase()}</span>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {micActive && (
              <div className="typing-indicator">
                <div className="typing-dots"><span /><span /><span /></div>
                <span>Analysing speech…</span>
              </div>
            )}
            <div ref={txEndRef} />
          </div>

          {/* Waveform + mic bar */}
          <div className="waveform-bar">
            <button
              className={`mic-btn ${micActive ? 'active' : 'idle'}`}
              onClick={() => micActive ? stopMic() : startMic()}
              title={micActive ? 'Mute microphone' : 'Start microphone'}
            >
              {micActive ? <MicOff size={20} color="#fff" /> : <Mic size={20} color="var(--text-2)" />}
            </button>
            <canvas ref={canvasRef} className="waveform-canvas" width={900} height={44} />
            <div className="mic-label">
              {micActive ? <><strong>LIVE</strong><br />tap to mute</> : <>tap to<br />start</>}
            </div>
          </div>
        </div>

        {/* ── Right: info sidebar ───────────────────────────────────── */}
        <div className="aside-panels">

          {/* Meeting info */}
          <div className="glass-card">
            <div className="card-header">
              <div className="card-header-left">
                <div className="card-header-icon"><FileText size={13} /></div>
                Meeting Info
              </div>
            </div>
            <div className="info-table">
              <div className="info-row">
                <span className="info-key">Status</span>
                <span className="info-val">
                  <span className={`chip ${isRecording ? 'chip-recording' : 'chip-stopped'}`}>{meeting.status}</span>
                </span>
              </div>
              <div className="info-row">
                <span className="info-key">Duration</span>
                <span className="info-val mono">{fmtTime(elapsed)}</span>
              </div>
              <InlineField label="Venue" value={meeting.venue}     canEdit={isRecording} onSave={v => saveField('venue', v)} />
              <InlineField label="Chair" value={meeting.chaired_by} canEdit={isRecording} onSave={v => saveField('chaired_by', v)} />
            </div>
            {isRecording && (
              <div style={{ padding: '6px 18px 10px', borderTop: '1px solid var(--border)' }}>
                <span className="text-3" style={{ fontSize: 11 }}>Click a field to edit inline</span>
              </div>
            )}
          </div>

          {/* Speakers */}
          <div className="glass-card">
            <div className="card-header">
              <div className="card-header-left">
                <div className="card-header-icon"><Users size={13} /></div>
                Detected Speakers
              </div>
            </div>
            <div className="spk-chips-wrap">
              {uniqueSpeakers.length === 0
                ? <span className="text-3" style={{ fontSize: 12 }}>None yet</span>
                : uniqueSpeakers.map(spk => {
                    const col = spkColour(spk);
                    return (
                      <span key={spk} className="chip" style={{ background: col + '22', color: col, border: `1px solid ${col}55` }}>
                        {fmtSpeaker(spk)}
                      </span>
                    );
                  })
              }
            </div>
          </div>

          {/* Agenda */}
          {meeting.agenda && meeting.agenda.length > 0 && (
            <div className="glass-card">
              <div className="card-header">
                <div className="card-header-left">
                  <div className="card-header-icon"><AlignLeft size={13} /></div>
                  Agenda
                </div>
              </div>
              <div className="agenda-list">
                {meeting.agenda.map((item, i) => (
                  <div key={i} className="agenda-item">
                    <span className="agenda-num">{i + 1}</span>
                    <span className="agenda-text">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action items */}
          <div className="glass-card">
            <div className="card-header">
              <div className="card-header-left">
                <div className="card-header-icon" style={{ background: 'var(--amber-dim)', color: 'var(--amber)' }}>
                  <Zap size={13} />
                </div>
                Action Items
              </div>
              <span className="badge">{actionItems.length}</span>
            </div>
            {actionItems.length === 0 ? (
              <div className="empty-state" style={{ padding: '18px 0' }}>
                <div className="empty-state-desc" style={{ fontSize: 12 }}>Action items detected during the meeting will appear here</div>
              </div>
            ) : (
              <div className="action-items-list">
                {actionItems.map(item => (
                  <ActionItemRow
                    key={item.id}
                    item={item}
                    onToggle={async (completed) => {
                      try {
                        await api.patch(`/meeting/${meetingId}/action-items/${item.id}`, { completed });
                        setActionItems(prev => prev.map(x => x.id === item.id ? { ...x, completed } : x));
                      } catch { /* ignore */ }
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Live summary */}
          {(summary || summaryLoading) && (
            <div className="glass-card">
              <div className="card-header">
                <div className="card-header-left">
                  <div className="card-header-icon" style={{ background: 'var(--purple-dim)', color: 'var(--purple)' }}>
                    <Sparkles size={13} />
                  </div>
                  Live Summary
                </div>
                {summaryLoading && <span className="text-3" style={{ fontSize: 11 }}>updating…</span>}
              </div>
              {summary ? (
                <div style={{ padding: '14px 18px', fontSize: 13, lineHeight: 1.6 }}>
                  {summary.overview && (
                    <div style={{ marginBottom: 12 }}>
                      <div className="text-3" style={{ fontSize: 10.5, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>Overview</div>
                      <div>{summary.overview}</div>
                    </div>
                  )}
                  {summary.decisions?.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div className="text-3" style={{ fontSize: 10.5, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>Decisions</div>
                      {summary.decisions.map((d, i) => <div key={i} style={{ marginBottom: 3 }}>• {d}</div>)}
                    </div>
                  )}
                  {summary.action_items?.length > 0 && (
                    <div>
                      <div className="text-3" style={{ fontSize: 10.5, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>Action Items</div>
                      {summary.action_items.map((a, i) => <div key={i} style={{ marginBottom: 3 }}>• {a}</div>)}
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state" style={{ padding: '18px 0' }}>
                  <div className="empty-state-desc" style={{ fontSize: 12 }}>Generating summary…</div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  );
}

function ActionItemRow({ item, onToggle }) {
  return (
    <div className={`action-item-row${item.completed ? ' completed' : ''}`}>
      <input type="checkbox" className="action-checkbox" checked={item.completed} onChange={e => onToggle(e.target.checked)} />
      <div className="action-body">
        <div className="action-text">{item.action_text}</div>
        <div className="action-meta">
          {item.assignee && <span className="action-assignee">👤 {item.assignee}</span>}
          {item.deadline  && <span className="action-deadline">📅 {item.deadline}</span>}
          {item.speaker   && <span className="action-assignee muted">{item.speaker}</span>}
        </div>
      </div>
    </div>
  );
}


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
function fmtTime(s) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function fmtEntryTime(entry) {
  if (entry.start_time != null) return new Date(entry.start_time * 1000).toISOString().substr(11, 8);
  if (entry.timestamp) return new Date(entry.timestamp).toISOString().substr(11, 8);
  return '';
}

/* ── Inline editable field ───────────────────────────────────────────────── */
function InlineField({ label, value, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value || '');
  const inputRef = useRef();

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(value || ''); }, [value]);

  function commit() {
    setEditing(false);
    if (draft.trim() !== (value || '').trim()) onSave(draft.trim());
  }

  return (
    <div className="info-row">
      <span className="info-k">{label}</span>
      <span className="info-v" style={{ flex: 1 }}>
        {editing ? (
          <div className="info-edit-row">
            <input
              ref={inputRef}
              className="info-edit-input"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setDraft(value || ''); } }}
            />
          </div>
        ) : (
          <div className="info-edit-row">
            <span>{value || <span className="muted" style={{ fontSize: 12 }}>—</span>}</span>
            {canEdit && (
              <span className="edit-icon" title="Edit" onClick={() => setEditing(true)}>✎</span>
            )}
          </div>
        )}
      </span>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */
export default function ActiveMeeting({ meetingId }) {
  const { navigate, setActiveMeetingId } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [meeting, setMeeting]         = useState(null);
  const [transcript, setTranscript]   = useState([]);
  const [actionItems, setActionItems] = useState([]);
  const [newEntryIds, setNewEntryIds] = useState(new Set());
  const [micActive, setMicActive]     = useState(false);
  const [elapsed, setElapsed]         = useState(0);
  const [loading, setLoading]         = useState(true);
  const [autoStartMic, setAutoStartMic] = useState(false);
  const [summary, setSummary]         = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const summaryTimerRef = useRef(null);

  const audioCtxRef  = useRef(null);
  const workletRef   = useRef(null);
  const analyserRef  = useRef(null);
  const sourceRef    = useRef(null);
  const streamRef    = useRef(null);
  const audioWsRef   = useRef(null);
  const txWsRef      = useRef(null);
  const canvasRef    = useRef(null);
  const animRef      = useRef(null);
  const txEndRef     = useRef(null);
  const timerRef     = useRef(null);
  const startTimeRef = useRef(null);
  const micActiveRef = useRef(false); // mirrors micActive for use in callbacks

  /* ── Load ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!meetingId) { navigate('dashboard'); return; }
    Promise.all([
      api.get(`/meeting/${meetingId}`),
      api.get(`/transcript/${meetingId}`).catch(() => ({ entries: [] })),
      api.get(`/meeting/${meetingId}/action-items`).catch(() => ({ items: [] })),
    ]).then(([m, txResp, aiResp]) => {
      setMeeting(m);
      setTranscript(txResp.entries || []);
      setActionItems(aiResp.items || []);
      setLoading(false);
      if (m.status === 'recording') {
        setActiveMeetingId(m.meeting_id);
        openTranscriptWs(m.meeting_id);
        const startMs = new Date(m.start_time).getTime();
        startTimeRef.current = startMs;
        setElapsed(Math.floor((Date.now() - startMs) / 1000));
        clearInterval(timerRef.current);
        timerRef.current = setInterval(
          () => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)),
          1000,
        );
        setAutoStartMic(true);
      }
    }).catch(() => { toast('Failed to load meeting', 'error'); navigate('dashboard'); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  useEffect(() => { txEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [transcript]);
  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live summary polling every 60 seconds
  useEffect(() => {
    if (!meetingId) return;
    async function fetchSummary() {
      if (summaryLoading) return;
      setSummaryLoading(true);
      try {
        const data = await api.get(`/chat/summary/${meetingId}`);
        setSummary(data);
      } catch { /* silently ignore — summary unavailable */ }
      finally { setSummaryLoading(false); }
    }
    fetchSummary(); // initial fetch
    summaryTimerRef.current = setInterval(fetchSummary, 60000);
    return () => clearInterval(summaryTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // Auto-start mic when meeting loads (flag set in load effect, triggered here to get fresh startMic ref)
  useEffect(() => {
    if (autoStartMic && !micActiveRef.current) {
      setAutoStartMic(false);
      startMic();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartMic]);

  // Resume AudioContext when user returns to tab (browsers suspend it when tab is hidden)
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
        // Reconnect audio WS if mic was active but WS dropped while in background
        if (micActiveRef.current && (!audioWsRef.current || audioWsRef.current.readyState > WebSocket.OPEN)) {
          reconnectAudioWs();
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Inline field save ───────────────────────────────────────────────── */
  async function saveField(field, val) {    try {
      const updated = await api.patch(`/meeting/${meetingId}`, { [field]: val });
      setMeeting(updated);
      toast(`${field === 'venue' ? 'Venue' : 'Chair'} updated`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ── Transcript WS ───────────────────────────────────────────────────── */
  function openTranscriptWs(id) {
    if (txWsRef.current) return;
    const ws = new WebSocket(wsUrl(`/transcript/ws/${id}`));
    txWsRef.current = ws;
    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'action_item') {
          setActionItems(prev => {
            if (prev.find(x => x.id === msg.data.id)) return prev;
            return [...prev, msg.data];
          });
          return;
        }
        const entry = msg.type === 'transcript' ? msg.data : msg;
        if (!entry.text) return;
        const eid = entry.id || `${Date.now()}`;
        setTranscript(t => [...t, { ...entry, _eid: eid }]);
        setNewEntryIds(s => new Set([...s, eid]));
        setTimeout(() => setNewEntryIds(s => { const n = new Set(s); n.delete(eid); return n; }), 1800);
      } catch { /* ignore */ }
    };
    ws.onerror = () => toast('Transcript stream disconnected', 'warn');
    ws.onclose = () => { txWsRef.current = null; };
    // Keepalive ping every 25s to prevent nginx proxy timeout
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      else clearInterval(pingInterval);
    }, 25000);
    ws._pingInterval = pingInterval;
  }

  /* ── Waveform ────────────────────────────────────────────────────────── */
  function startWaveform() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    const buf = new Uint8Array(analyser.frequencyBinCount);
    function draw() {
      animRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(buf);
      const W = canvas.width, H = canvas.height;
      ctx.fillStyle = '#0b0f16'; ctx.fillRect(0, 0, W, H);
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#1f6feb'); grad.addColorStop(.5, '#388bfd'); grad.addColorStop(1, '#3fb950');
      ctx.lineWidth = 2; ctx.strokeStyle = grad;
      ctx.shadowBlur = 8; ctx.shadowColor = '#388bfd';
      ctx.beginPath();
      const step = W / buf.length;
      for (let i = 0; i < buf.length; i++) {
        const y = (buf[i] / 255) * H;
        i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * step, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    draw();
  }

  function stopWaveform() {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    const canvas = canvasRef.current;
    if (canvas) { const ctx = canvas.getContext('2d'); ctx.fillStyle = '#0b0f16'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  }

  /* ── Mic ─────────────────────────────────────────────────────────────── */
  function connectAudioWs() {
    const ws = new WebSocket(wsUrl(`/meeting/ws/audio/${meetingId}`));
    audioWsRef.current = ws; ws.binaryType = 'arraybuffer';
    workletRef.current.port.onmessage = ev => { if (ws.readyState === WebSocket.OPEN) ws.send(ev.data); };
    ws.onopen  = () => startWaveform();
    ws.onerror = () => toast('Audio stream error', 'error');
    ws.onclose = () => {
      // Auto-reconnect if mic is still supposed to be active
      if (micActiveRef.current) {
        setTimeout(() => {
          if (micActiveRef.current) reconnectAudioWs();
        }, 1500);
      }
    };
  }

  function reconnectAudioWs() {
    if (audioWsRef.current) {
      try { audioWsRef.current.close(); } catch { /* ignore */ }
      audioWsRef.current = null;
    }
    if (!workletRef.current) return;
    connectAudioWs();
  }

  const startMic = useCallback(async () => {
    if (!meetingId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 }, video: false })
        .catch(err => {
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
            throw new Error('Microphone access denied. Click the 🔒 icon in your browser address bar, set Microphone to "Allow", then reload.');
          if (err.name === 'NotFoundError')
            throw new Error('No microphone found. Please connect a microphone and try again.');
          throw err;
        });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = ctx;
      await ctx.audioWorklet.addModule('/audio-processor.js');
      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, 'audio-processor');
      const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
      analyserRef.current = analyser;
      source.connect(analyser); source.connect(worklet);
      sourceRef.current = source; workletRef.current = worklet;

      connectAudioWs();
      openTranscriptWs(meetingId);
      micActiveRef.current = true;
      setMicActive(true);
      toast('Microphone active — recording', 'success');
    } catch (err) { toast(err.message, 'error'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  function stopMic() {
    micActiveRef.current = false;
    clearInterval(timerRef.current);
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    workletRef.current?.disconnect(); sourceRef.current?.disconnect();
    analyserRef.current = null; audioCtxRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (audioWsRef.current?.readyState === WebSocket.OPEN) audioWsRef.current.close();
    audioWsRef.current = null; workletRef.current = null; sourceRef.current = null;
    audioCtxRef.current = null; streamRef.current = null;
    stopWaveform(); setMicActive(false);
  }

  function stopAll() {
    stopMic();
    if (txWsRef.current) {
      if (txWsRef.current._pingInterval) clearInterval(txWsRef.current._pingInterval);
      txWsRef.current.close();
      txWsRef.current = null;
    }
  }

  async function stopMeeting() {
    stopAll();
    try {
      await api.post(`/meeting/${meetingId}/stop`);
      setActiveMeetingId(null);
      toast('Meeting stopped — processing transcript', 'info');
      navigate('meeting-detail', meetingId);
    } catch (err) { toast(err.message, 'error'); }
  }

  if (loading) return <div className="empty">Loading meeting…</div>;
  if (!meeting) return null;

  const isRecording = meeting.status === 'recording';
  const uniqueSpeakers = [...new Set(transcript.map(t => t.speaker).filter(Boolean))];
  const wordCount = transcript.reduce((n, e) => n + (e.text || '').split(/\s+/).filter(Boolean).length, 0);

  return (
    <>
      {/* ── Top header ────────────────────────────────────────────────── */}
      <div className="page-hdr" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            {isRecording && (
              <div className="rec-badge" style={{ marginBottom: 0 }}>
                <div className="status-dot warn" style={{ width: 8, height: 8 }} />
                RECORDING
              </div>
            )}
            <h1 style={{ margin: 0 }}>{meeting.title}</h1>
          </div>
          <div className="meeting-stats-bar">
            <div className="meeting-stat">⏱ <strong>{fmtTime(elapsed)}</strong></div>
            <div className="meeting-stat">💬 <strong>{transcript.length}</strong> entries</div>
            <div className="meeting-stat">👥 <strong>{uniqueSpeakers.length}</strong> speakers</div>
            <div className="meeting-stat">📝 <strong>{wordCount}</strong> words</div>
          </div>
        </div>
        <div className="page-hdr-actions">
          <button className="btn btn-danger btn-lg" onClick={stopMeeting}>■ Stop Meeting</button>
        </div>
      </div>

      <div className="meeting-layout">
        {/* ── Left: AI transcript ───────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minHeight: 0 }}>
          <div className="tx-ai-panel">
            <div className="tx-ai-header">
              <span>◈ Live AI Transcript</span>
              <span className="badge">{transcript.length}</span>
            </div>

            <div className="tx-ai-box">
              {transcript.length === 0 ? (
                <div className="tx-waiting">
                  <div className="pulse-ring" />
                  <span style={{ fontSize: 14 }}>Waiting for speech…</span>
                  <span className="muted" style={{ fontSize: 12 }}>Start your microphone below</span>
                </div>
              ) : (
                transcript.map((entry, i) => {
                  const eid  = entry._eid || entry.id || i;
                  const isNew = newEntryIds.has(eid);
                  const col  = spkColour(entry.speaker || '');
                  const lang = entry.language;
                  return (
                    <div key={i} className={`tx-ai-entry${isNew ? ' new-entry' : ''}`}>
                      <div
                        className={`tx-ai-orb${isNew ? ' new-entry-orb' : ''}`}
                        style={{ background: col, '--orb-color': col }}
                      >
                        {fmtSpeaker(entry.speaker).charAt(0).toUpperCase()}
                      </div>
                      <div className="tx-ai-content">
                        <div className="tx-ai-speaker" style={{ color: col }}>
                          {fmtSpeaker(entry.speaker)}
                          {isNew && <span style={{ color: 'var(--c-muted)', fontWeight: 400, fontSize: 10, letterSpacing: 0 }}>◈ now</span>}
                        </div>
                        <div className="tx-ai-text">{entry.text}</div>
                        <div className="tx-ai-footer">
                          <span className="tx-ai-time">{fmtEntryTime(entry)}</span>
                          {lang && <span className="lang-badge">{lang === 'ur' || lang === 'urdu' ? 'اردو' : lang.toUpperCase()}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {/* AI thinking indicator */}
              {micActive && (
                <div className="ai-thinking">
                  <div className="ai-thinking-dots"><span /><span /><span /></div>
                  <span>Analysing speech…</span>
                </div>
              )}
              <div ref={txEndRef} />
            </div>
          </div>

          {/* Bottom bar: waveform + mic */}
          <div className="meeting-bottom-bar">
            <button
              className={`mic-btn ${micActive ? 'active' : 'idle'}`}
              onClick={() => micActive ? stopMic() : startMic()}
              title={micActive ? 'Mute microphone' : 'Start microphone — browser will ask for permission'}
            >
              {micActive ? '🔴' : '🎙'}
            </button>
            <canvas ref={canvasRef} className="waveform-canvas" width={900} height={52} />
            <div style={{ fontSize: 11, color: 'var(--c-muted)', flexShrink: 0, textAlign: 'center', lineHeight: 1.5 }}>
              {micActive ? <><strong style={{ color: 'var(--c-danger)' }}>LIVE</strong><br/>tap to mute</> : <>tap to<br/>start</>}
            </div>
          </div>
        </div>

        {/* ── Right: info sidebar ───────────────────────────────────── */}
        <div className="aside-panels">
          <div className="card">
            <div className="card-hdr">Meeting Info</div>
            <div className="info-list">
              <div className="info-row">
                <span className="info-k">Status</span>
                <span className="info-v"><span className={`chip ${isRecording ? 'chip-recording' : 'chip-stopped'}`}>{meeting.status}</span></span>
              </div>
              <div className="info-row">
                <span className="info-k">Duration</span>
                <span className="info-v">{fmtTime(elapsed)}</span>
              </div>
              <InlineField
                label="Venue"
                value={meeting.venue}
                canEdit={isRecording}
                onSave={v => saveField('venue', v)}
              />
              <InlineField
                label="Chair"
                value={meeting.chaired_by}
                canEdit={isRecording}
                onSave={v => saveField('chaired_by', v)}
              />
            </div>
            {isRecording && (
              <div style={{ padding: '8px 18px', borderTop: '1px solid var(--c-border)' }}>
                <div className="muted" style={{ fontSize: 11 }}>✎ Click a field value to edit</div>
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 0 }}>
            <div className="card-hdr">Detected Speakers</div>
            <div className="spk-chips">
              {uniqueSpeakers.length === 0
                ? <span className="muted" style={{ fontSize: 12 }}>None yet</span>
                : uniqueSpeakers.map(spk => {
                    const col = spkColour(spk);
                    return (
                      <span key={spk} className="chip" style={{ background: col + '22', color: col, border: `1px solid ${col}55` }}>
                        {fmtSpeaker(spk)}
                      </span>
                    );
                  })
              }
            </div>
          </div>

          <div className="card" style={{ marginTop: 0 }}>
            <div className="card-hdr">Actions</div>
            <div className="quick-stack">
              <button className="btn btn-outline btn-w" onClick={() => navigate('meeting-detail', meetingId)}>📄 View Detail</button>
              <button className="btn btn-danger btn-w" onClick={stopMeeting}>■ Stop &amp; Save</button>
            </div>
          </div>

          {/* ── Agenda panel ─────────────────────────────────────────── */}
          {meeting.agenda && meeting.agenda.length > 0 && (
            <div className="card" style={{ marginTop: 0 }}>
              <div className="card-hdr">📋 Agenda</div>
              <div className="agenda-list">
                {meeting.agenda.map((item, i) => (
                  <div key={i} className="agenda-item">
                    <span className="agenda-num">{i + 1}</span>
                    <span className="agenda-text">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Live action items panel ───────────────────────────────── */}
          <div className="card action-items-card" style={{ marginTop: 0 }}>
            <div className="card-hdr">
              ⚡ Action Items
              <span className="badge" style={{ background: actionItems.length ? 'var(--c-warning)' : undefined }}>
                {actionItems.length}
              </span>
            </div>
            {actionItems.length === 0 ? (
              <div className="empty" style={{ padding: '14px 18px', fontSize: 12 }}>
                Action items detected during the meeting will appear here
              </div>
            ) : (
              <div className="action-items-list">
                {actionItems.map(item => (
                  <ActionItemRow
                    key={item.id}
                    item={item}
                    onToggle={async (completed) => {
                      try {
                        await api.patch(`/meeting/${meetingId}/action-items/${item.id}`, { completed });
                        setActionItems(prev => prev.map(x => x.id === item.id ? { ...x, completed } : x));
                      } catch { /* ignore */ }
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          {/* ── Live summary panel ───────────────────────────────── */}
          {(summary || summaryLoading) && (
            <div className="card" style={{ marginTop: 0 }}>
              <div className="card-hdr">
                ✦ Live Summary
                {summaryLoading && <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>updating…</span>}
              </div>
              {summary ? (
                <div style={{ padding: '10px 18px', fontSize: 13, lineHeight: 1.6 }}>
                  {summary.overview && (
                    <div style={{ marginBottom: 10 }}>
                      <div className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Overview</div>
                      <div>{summary.overview}</div>
                    </div>
                  )}
                  {summary.decisions?.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Decisions</div>
                      {summary.decisions.map((d, i) => <div key={i} style={{ marginBottom: 3 }}>• {d}</div>)}
                    </div>
                  )}
                  {summary.action_items?.length > 0 && (
                    <div>
                      <div className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Action Items</div>
                      {summary.action_items.map((a, i) => <div key={i} style={{ marginBottom: 3 }}>• {a}</div>)}
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty" style={{ padding: '14px 18px', fontSize: 12 }}>Generating summary…</div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ActionItemRow({ item, onToggle }) {
  return (
    <div className={`action-item-row${item.completed ? ' completed' : ''}`}>
      <input
        type="checkbox"
        className="action-checkbox"
        checked={item.completed}
        onChange={e => onToggle(e.target.checked)}
      />
      <div className="action-body">
        <div className="action-text">{item.action_text}</div>
        <div className="action-meta">
          {item.assignee && <span className="action-assignee">👤 {item.assignee}</span>}
          {item.deadline  && <span className="action-deadline">📅 {item.deadline}</span>}
          <span className="action-speaker muted">{item.speaker}</span>
        </div>
      </div>
    </div>
  );
}
